#import <Foundation/Foundation.h>
#import <PDFKit/PDFKit.h>
#import <TargetConditionals.h>
#import <Vision/Vision.h>
#if TARGET_OS_OSX
#import <AppKit/AppKit.h>
#else
#import <UIKit/UIKit.h>
#endif
#include <math.h>
#include <stdlib.h>
#include <string.h>

static char *folio_copy_utf8(NSString *value) {
  if (value == nil) {
    return NULL;
  }
  const char *utf8 = [value UTF8String];
  if (utf8 == NULL) {
    return NULL;
  }
  size_t length = strlen(utf8);
  char *copy = malloc(length + 1);
  if (copy == NULL) {
    return NULL;
  }
  memcpy(copy, utf8, length + 1);
  return copy;
}

static void folio_set_error(char **error_out, NSString *message) {
  if (error_out != NULL) {
    *error_out = folio_copy_utf8(message ?: @"Document extraction failed.");
  }
}

static char *folio_json_result(NSDictionary *payload, char **error_out) {
  NSError *serialization_error = nil;
  NSData *json = [NSJSONSerialization dataWithJSONObject:payload
                                                 options:0
                                                   error:&serialization_error];
  if (json == nil) {
    folio_set_error(error_out, serialization_error.localizedDescription);
    return NULL;
  }
  NSString *value = [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding];
  char *result = folio_copy_utf8(value);
  if (result == NULL) {
    folio_set_error(error_out, @"Document extraction ran out of memory.");
  }
  return result;
}

static CGImageRef folio_copy_pdf_page_image(PDFPage *page) {
  CGRect bounds = [page boundsForBox:kPDFDisplayBoxCropBox];
  CGFloat longest_side = MAX(CGRectGetWidth(bounds), CGRectGetHeight(bounds));
  if (!isfinite(longest_side) || longest_side <= 0) {
    return NULL;
  }
  CGFloat scale = 1800.0 / longest_side;
  scale = MIN(3.0, MAX(0.75, scale));
  CGSize size = CGSizeMake(
    MAX(1.0, floor(CGRectGetWidth(bounds) * scale)),
    MAX(1.0, floor(CGRectGetHeight(bounds) * scale))
  );
  id thumbnail = [page thumbnailOfSize:size forBox:kPDFDisplayBoxCropBox];
#if TARGET_OS_OSX
  CGImageRef source_image = [(NSImage *)thumbnail CGImageForProposedRect:NULL
                                                               context:nil
                                                                 hints:nil];
#else
  CGImageRef source_image = [(UIImage *)thumbnail CGImage];
#endif
  if (source_image == NULL) {
    return NULL;
  }
  size_t pixel_width = MAX(2, (size_t)ceil(size.width));
  size_t pixel_height = MAX(2, (size_t)ceil(size.height));
  CGColorSpaceRef color_space = CGColorSpaceCreateDeviceRGB();
  CGContextRef context = CGBitmapContextCreate(
    NULL,
    pixel_width,
    pixel_height,
    8,
    pixel_width * 4,
    color_space,
    kCGImageAlphaPremultipliedLast | kCGBitmapByteOrder32Big
  );
  CGColorSpaceRelease(color_space);
  if (context == NULL) {
    return NULL;
  }
  CGContextSetRGBFillColor(context, 1, 1, 1, 1);
  CGContextFillRect(context, CGRectMake(0, 0, pixel_width, pixel_height));
  CGContextSetInterpolationQuality(context, kCGInterpolationHigh);
  CGContextDrawImage(
    context,
    CGRectMake(0, 0, pixel_width, pixel_height),
    source_image
  );
  CGImageRef normalized_image = CGBitmapContextCreateImage(context);
  CGContextRelease(context);
  return normalized_image;
}

static BOOL folio_append_ocr_blocks(
  VNImageRequestHandler *handler,
  NSInteger page_number,
  NSMutableArray *blocks,
  NSUInteger maximum_blocks,
  BOOL *limit_reached,
  NSError **error_out
) API_AVAILABLE(macos(10.15), ios(13.0));

static BOOL folio_append_ocr_blocks(
  VNImageRequestHandler *handler,
  NSInteger page_number,
  NSMutableArray *blocks,
  NSUInteger maximum_blocks,
  BOOL *limit_reached,
  NSError **error_out
) {
  VNRecognizeTextRequest *request = [[VNRecognizeTextRequest alloc] init];
  request.recognitionLevel = VNRequestTextRecognitionLevelAccurate;
  request.usesLanguageCorrection = YES;
  if (@available(macOS 13.0, iOS 16.0, *)) {
    request.automaticallyDetectsLanguage = YES;
  } else {
    request.recognitionLanguages = @[@"zh-Hans", @"en-US"];
  }
  if (![handler performRequests:@[request] error:error_out]) {
    return NO;
  }
  NSArray<VNRecognizedTextObservation *> *observations =
    (NSArray<VNRecognizedTextObservation *> *)request.results;
  observations = [observations sortedArrayUsingComparator:^NSComparisonResult(
    VNRecognizedTextObservation *left,
    VNRecognizedTextObservation *right
  ) {
    CGFloat left_y = CGRectGetMaxY(left.boundingBox);
    CGFloat right_y = CGRectGetMaxY(right.boundingBox);
    if (fabs(left_y - right_y) > 0.015) {
      return left_y > right_y ? NSOrderedAscending : NSOrderedDescending;
    }
    CGFloat left_x = CGRectGetMinX(left.boundingBox);
    CGFloat right_x = CGRectGetMinX(right.boundingBox);
    if (left_x == right_x) {
      return NSOrderedSame;
    }
    return left_x < right_x ? NSOrderedAscending : NSOrderedDescending;
  }];
  for (VNRecognizedTextObservation *observation in observations) {
    if (blocks.count >= maximum_blocks) {
      if (limit_reached != NULL) {
        *limit_reached = YES;
      }
      break;
    }
    VNRecognizedText *candidate = [[observation topCandidates:1] firstObject];
    if (candidate == nil || candidate.string.length == 0) {
      continue;
    }
    CGRect box = observation.boundingBox;
    [blocks addObject:@{
      @"page": @(page_number),
      @"text": candidate.string,
      @"confidence": @(candidate.confidence),
      @"box": @{
        @"x": @(box.origin.x),
        @"y": @(box.origin.y),
        @"width": @(box.size.width),
        @"height": @(box.size.height)
      }
    }];
  }
  return YES;
}

static char *folio_extract_pdf(NSData *data, char **error_out) {
  PDFDocument *document = [[PDFDocument alloc] initWithData:data];
  if (document == nil) {
    folio_set_error(error_out, @"The selected PDF is invalid or password protected.");
    return NULL;
  }
  if ([document isLocked]) {
    folio_set_error(error_out, @"Password-protected PDF files are not supported.");
    return NULL;
  }
  NSInteger page_count = document.pageCount;
  if (page_count < 1 || page_count > 50) {
    folio_set_error(error_out, @"PDF files must contain 1 to 50 pages.");
    return NULL;
  }
  NSMutableArray *blocks = [NSMutableArray array];
  NSUInteger total_characters = 0;
  BOOL truncated = NO;
  NSUInteger ocr_page_count = 0;
  NSUInteger unreadable_page_count = 0;
  BOOL ocr_available = NO;
  if (@available(macOS 10.15, iOS 13.0, *)) {
    ocr_available = YES;
  }
  for (NSInteger index = 0; index < page_count; index++) {
    if (blocks.count >= 200) {
      truncated = YES;
      break;
    }
    PDFPage *page = [document pageAtIndex:index];
    NSString *text = [page.string ?: @""
      stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
    if (text.length > 0) {
      NSUInteger remaining = total_characters >= 100000 ? 0 : 100000 - total_characters;
      if (remaining == 0) {
        truncated = YES;
        break;
      }
      if (text.length > remaining) {
        text = [text substringToIndex:remaining];
        truncated = YES;
      }
      total_characters += text.length;
      [blocks addObject:@{
        @"page": @(index + 1),
        @"text": text
      }];
      continue;
    }
    if (@available(macOS 10.15, iOS 13.0, *)) {
      @autoreleasepool {
        CGImageRef image = folio_copy_pdf_page_image(page);
        if (image == NULL) {
          unreadable_page_count += 1;
          truncated = YES;
        } else {
          NSUInteger blocks_before_ocr = blocks.count;
          VNImageRequestHandler *handler =
            [[VNImageRequestHandler alloc] initWithCGImage:image options:@{}];
          NSError *vision_error = nil;
          BOOL succeeded = folio_append_ocr_blocks(
            handler,
            index + 1,
            blocks,
            200,
            &truncated,
            &vision_error
          );
          CGImageRelease(image);
          if (!succeeded) {
            folio_set_error(error_out, vision_error.localizedDescription);
            return NULL;
          }
          if (blocks.count > blocks_before_ocr) {
            ocr_page_count += 1;
          } else {
            unreadable_page_count += 1;
          }
        }
      }
    } else {
      unreadable_page_count += 1;
      truncated = YES;
    }
  }
  if (blocks.count == 0) {
    NSString *message = unreadable_page_count > 0 && !ocr_available
      ? @"Scanned PDF OCR requires macOS 10.15 or iOS 13."
      : @"No readable text was found in the selected PDF.";
    folio_set_error(error_out, message);
    return NULL;
  }
  return folio_json_result(@{
    @"format": @"pdf",
    @"pageCount": @(page_count),
    @"blocks": blocks,
    @"truncated": @(truncated),
    @"ocrPageCount": @(ocr_page_count),
    @"unreadablePageCount": @(unreadable_page_count)
  }, error_out);
}

static char *folio_extract_image(NSData *data, char **error_out)
  API_AVAILABLE(macos(10.15), ios(13.0));

static char *folio_extract_image(NSData *data, char **error_out) {
  VNImageRequestHandler *handler = [[VNImageRequestHandler alloc] initWithData:data options:@{}];
  NSError *vision_error = nil;
  NSMutableArray *blocks = [NSMutableArray array];
  BOOL truncated = NO;
  if (!folio_append_ocr_blocks(
    handler,
    1,
    blocks,
    200,
    &truncated,
    &vision_error
  )) {
    folio_set_error(error_out, vision_error.localizedDescription);
    return NULL;
  }
  if (blocks.count == 0) {
    folio_set_error(error_out, @"No readable text was found in the selected image.");
    return NULL;
  }
  return folio_json_result(@{
    @"format": @"image",
    @"pageCount": @1,
    @"blocks": blocks,
    @"truncated": @(truncated),
    @"ocrPageCount": @1,
    @"unreadablePageCount": @0
  }, error_out);
}

char *folio_apple_extract_document(
  const unsigned char *bytes,
  size_t length,
  int kind,
  char **error_out
) {
  @autoreleasepool {
    if (error_out != NULL) {
      *error_out = NULL;
    }
    if (bytes == NULL || length == 0) {
      folio_set_error(error_out, @"The selected document is empty.");
      return NULL;
    }
    NSData *data = [NSData dataWithBytesNoCopy:(void *)bytes
                                        length:length
                                  freeWhenDone:NO];
    if (kind == 1) {
      return folio_extract_pdf(data, error_out);
    }
    if (kind == 2) {
      if (@available(macOS 10.15, iOS 13.0, *)) {
        return folio_extract_image(data, error_out);
      }
      folio_set_error(error_out, @"Device-only image OCR requires macOS 10.15 or iOS 13.");
      return NULL;
    }
    folio_set_error(error_out, @"The selected document type is unsupported.");
    return NULL;
  }
}

void folio_apple_free_string(char *value) {
  free(value);
}
