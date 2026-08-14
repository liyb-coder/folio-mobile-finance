#import <AVFoundation/AVFoundation.h>
#import <Foundation/Foundation.h>
#import <Speech/Speech.h>
#import <TargetConditionals.h>
#import <math.h>
#import <stdatomic.h>
#import <stdint.h>

typedef void (*FolioSpeechEventCallback)(const char *kind, const char *text,
                                         float level, void *context);

static atomic_bool FolioSpeechCaptureActive = false;
static atomic_bool FolioSpeechStopRequested = false;

int32_t folio_speech_stop_current(void) {
  if (!atomic_load_explicit(&FolioSpeechCaptureActive, memory_order_acquire)) {
    return 0;
  }
  atomic_store_explicit(&FolioSpeechStopRequested, true, memory_order_release);
  return 1;
}

static void FolioEmitSpeechEvent(FolioSpeechEventCallback callback,
                                 void *context, NSString *kind,
                                 NSString *text, float level) {
  if (callback == NULL || context == NULL || kind.length == 0) {
    return;
  }
  callback(kind.UTF8String, text.length > 0 ? text.UTF8String : NULL, level,
           context);
}

static char *FolioSpeechJSON(NSDictionary *payload) {
  NSError *error = nil;
  NSData *data = [NSJSONSerialization dataWithJSONObject:payload options:0 error:&error];
  if (error != nil || data == nil) {
    return strdup("{\"status\":\"internal_error\",\"onDevice\":false}");
  }
  char *result = malloc(data.length + 1);
  if (result == NULL) {
    return NULL;
  }
  memcpy(result, data.bytes, data.length);
  result[data.length] = '\0';
  return result;
}

static char *FolioSpeechStatus(NSString *status) {
  return FolioSpeechJSON(@{
    @"status": status,
    @"onDevice": @NO,
  });
}

static BOOL FolioWaitForMicrophonePermission(void) {
  AVAuthorizationStatus current =
      [AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeAudio];
  if (current == AVAuthorizationStatusAuthorized) {
    return YES;
  }
  if (current != AVAuthorizationStatusNotDetermined) {
    return NO;
  }
  dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
  __block BOOL granted = NO;
  [AVCaptureDevice requestAccessForMediaType:AVMediaTypeAudio
                           completionHandler:^(BOOL allowed) {
                             granted = allowed;
                             dispatch_semaphore_signal(semaphore);
                           }];
  dispatch_time_t timeout =
      dispatch_time(DISPATCH_TIME_NOW, (int64_t)(30 * NSEC_PER_SEC));
  return dispatch_semaphore_wait(semaphore, timeout) == 0 && granted;
}

static BOOL FolioWaitForSpeechPermission(void) {
  SFSpeechRecognizerAuthorizationStatus current =
      [SFSpeechRecognizer authorizationStatus];
  if (current == SFSpeechRecognizerAuthorizationStatusAuthorized) {
    return YES;
  }
  if (current != SFSpeechRecognizerAuthorizationStatusNotDetermined) {
    return NO;
  }
  dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
  __block SFSpeechRecognizerAuthorizationStatus next =
      SFSpeechRecognizerAuthorizationStatusNotDetermined;
  [SFSpeechRecognizer
      requestAuthorization:^(SFSpeechRecognizerAuthorizationStatus status) {
        next = status;
        dispatch_semaphore_signal(semaphore);
      }];
  dispatch_time_t timeout =
      dispatch_time(DISPATCH_TIME_NOW, (int64_t)(30 * NSEC_PER_SEC));
  return dispatch_semaphore_wait(semaphore, timeout) == 0 &&
         next == SFSpeechRecognizerAuthorizationStatusAuthorized;
}

char *folio_speech_transcribe_once(const char *locale_code,
                                   uint32_t max_seconds,
                                   FolioSpeechEventCallback callback,
                                   void *callback_context) {
  @autoreleasepool {
    if (@available(macOS 10.15, iOS 13.0, *)) {
      if (!FolioWaitForMicrophonePermission()) {
        return FolioSpeechStatus(@"microphone_denied");
      }
      if (!FolioWaitForSpeechPermission()) {
        return FolioSpeechStatus(@"speech_denied");
      }

      NSString *localeString =
          locale_code == NULL ? @"zh-CN"
                              : [NSString stringWithUTF8String:locale_code];
      NSLocale *locale = [[NSLocale alloc] initWithLocaleIdentifier:localeString];
      SFSpeechRecognizer *recognizer =
          [[SFSpeechRecognizer alloc] initWithLocale:locale];
      if (recognizer == nil || !recognizer.available) {
        return FolioSpeechStatus(@"unavailable");
      }
      if (!recognizer.supportsOnDeviceRecognition) {
        return FolioSpeechStatus(@"on_device_unavailable");
      }

#if TARGET_OS_IOS
      AVAudioSession *session = [AVAudioSession sharedInstance];
      NSError *sessionError = nil;
      [session setCategory:AVAudioSessionCategoryRecord
                      mode:AVAudioSessionModeMeasurement
                   options:AVAudioSessionCategoryOptionDuckOthers
                     error:&sessionError];
      if (sessionError == nil) {
        [session setActive:YES
               withOptions:AVAudioSessionSetActiveOptionNotifyOthersOnDeactivation
                     error:&sessionError];
      }
      if (sessionError != nil) {
        return FolioSpeechStatus(@"audio_unavailable");
      }
#endif

      AVAudioEngine *engine = [[AVAudioEngine alloc] init];
      AVAudioInputNode *input = engine.inputNode;
      AVAudioFormat *format = [input outputFormatForBus:0];
      if (format.sampleRate <= 0 || format.channelCount == 0) {
        return FolioSpeechStatus(@"audio_unavailable");
      }

      SFSpeechAudioBufferRecognitionRequest *request =
          [[SFSpeechAudioBufferRecognitionRequest alloc] init];
      request.shouldReportPartialResults = YES;
      request.requiresOnDeviceRecognition = YES;
      request.taskHint = SFSpeechRecognitionTaskHintDictation;
      request.contextualStrings = @[
        @"账户", @"流水", @"支出", @"收入", @"转账", @"提醒", @"规划",
        @"人民币", @"招商银行", @"建设银行"
      ];

      NSObject *lock = [[NSObject alloc] init];
      dispatch_semaphore_t completion = dispatch_semaphore_create(0);
      __block NSString *recognizedText = @"";
      __block BOOL finished = NO;
      __block BOOL failed = NO;
      __block FolioSpeechEventCallback activeCallback = callback;
      __block NSTimeInterval lastLevelAt = 0;
      SFSpeechRecognitionTask *task = [recognizer
          recognitionTaskWithRequest:request
                       resultHandler:^(SFSpeechRecognitionResult *result,
                                       NSError *error) {
                         @synchronized(lock) {
                           if (result.bestTranscription.formattedString.length >
                               0) {
                             recognizedText =
                                 result.bestTranscription.formattedString;
                             FolioEmitSpeechEvent(
                                 activeCallback, callback_context,
                                 result.isFinal ? @"final" : @"partial",
                                 recognizedText, 0);
                           }
                           if (!finished && (result.isFinal || error != nil)) {
                             finished = YES;
                             failed = error != nil && recognizedText.length == 0;
                             dispatch_semaphore_signal(completion);
                           }
                         }
                       }];

      [input installTapOnBus:0
                  bufferSize:1024
                      format:format
                       block:^(AVAudioPCMBuffer *buffer, AVAudioTime *_when) {
                         (void)_when;
                         [request appendAudioPCMBuffer:buffer];
                         NSTimeInterval now =
                             [NSDate timeIntervalSinceReferenceDate];
                         if (now - lastLevelAt >= 0.055 &&
                             buffer.floatChannelData != NULL &&
                             buffer.frameLength > 0) {
                           lastLevelAt = now;
                           float *samples = buffer.floatChannelData[0];
                           double squareSum = 0;
                           AVAudioFrameCount sampleCount = buffer.frameLength;
                           AVAudioFrameCount stride = sampleCount > 512 ? 4 : 1;
                           AVAudioFrameCount measured = 0;
                           for (AVAudioFrameCount index = 0; index < sampleCount;
                                index += stride) {
                             float sample = samples[index];
                             squareSum += sample * sample;
                             measured += 1;
                           }
                           float rms = measured > 0
                                           ? (float)sqrt(squareSum / measured)
                                           : 0;
                           float normalized = MIN(1.0f, rms * 9.0f);
                           @synchronized(lock) {
                             FolioEmitSpeechEvent(activeCallback,
                                                  callback_context, @"level",
                                                  nil, normalized);
                           }
                         }
                       }];
      [engine prepare];
      NSError *startError = nil;
      if (![engine startAndReturnError:&startError]) {
        @synchronized(lock) {
          activeCallback = NULL;
        }
        [input removeTapOnBus:0];
        [task cancel];
        return FolioSpeechStatus(@"audio_unavailable");
      }
      atomic_store_explicit(&FolioSpeechStopRequested, false,
                            memory_order_release);
      atomic_store_explicit(&FolioSpeechCaptureActive, true,
                            memory_order_release);
      @synchronized(lock) {
        FolioEmitSpeechEvent(activeCallback, callback_context, @"listening",
                             nil, 0);
      }

      uint32_t bounded = MAX(3, MIN(max_seconds, 30));
      NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:bounded];
      long waitResult = 1;
      BOOL stoppedByUser = NO;
      while ([deadline timeIntervalSinceNow] > 0) {
        dispatch_time_t interval = dispatch_time(
            DISPATCH_TIME_NOW, (int64_t)(50 * NSEC_PER_MSEC));
        waitResult = dispatch_semaphore_wait(completion, interval);
        if (waitResult == 0) {
          break;
        }
        if (atomic_load_explicit(&FolioSpeechStopRequested,
                                 memory_order_acquire)) {
          stoppedByUser = YES;
          break;
        }
      }

      atomic_store_explicit(&FolioSpeechCaptureActive, false,
                            memory_order_release);

      [engine stop];
      [input removeTapOnBus:0];
      [request endAudio];
      if (stoppedByUser) {
        BOOL alreadyFinished = NO;
        @synchronized(lock) {
          alreadyFinished = finished;
        }
        if (!alreadyFinished) {
          dispatch_time_t finalizationTimeout = dispatch_time(
              DISPATCH_TIME_NOW, (int64_t)(1500 * NSEC_PER_MSEC));
          waitResult = dispatch_semaphore_wait(completion,
                                                finalizationTimeout);
        }
      }
      BOOL didFinish = NO;
      @synchronized(lock) {
        didFinish = finished;
      }
      if (waitResult != 0 || !didFinish) {
        [task cancel];
      }
#if TARGET_OS_IOS
      [[AVAudioSession sharedInstance] setActive:NO
                                    withOptions:AVAudioSessionSetActiveOptionNotifyOthersOnDeactivation
                                          error:nil];
#endif

      NSString *finalText = nil;
      BOOL finalFailed = NO;
      @synchronized(lock) {
        FolioEmitSpeechEvent(activeCallback, callback_context, @"stopped", nil,
                             0);
        finalText = [recognizedText
            stringByTrimmingCharactersInSet:
                [NSCharacterSet whitespaceAndNewlineCharacterSet]];
        finalFailed = failed;
        activeCallback = NULL;
      }
      if (finalText.length > 0) {
        return FolioSpeechJSON(@{
          @"status": @"transcribed",
          @"text": finalText,
          @"locale": localeString,
          @"onDevice": @YES,
        });
      }
      return FolioSpeechStatus(finalFailed ? @"recognition_failed"
                                           : @"no_speech");
    }
    return FolioSpeechStatus(@"unsupported_os");
  }
}

void folio_speech_free(char *value) {
  free(value);
}
