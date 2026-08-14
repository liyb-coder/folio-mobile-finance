#import <Foundation/Foundation.h>
#import <TargetConditionals.h>
#import <UserNotifications/UserNotifications.h>
#include <stdlib.h>
#include <string.h>

static void folio_set_error(char **error_out, NSString *message) {
    if (error_out == NULL) return;
    const char *utf8 = message.UTF8String ?: "Unknown notification error.";
    *error_out = strdup(utf8);
}

static BOOL folio_notifications_available(void) {
    if (@available(macOS 10.14, iOS 10.0, *)) return YES;
    return NO;
}

@interface FolioNotificationDelegate : NSObject <UNUserNotificationCenterDelegate>
@end

@implementation FolioNotificationDelegate
- (void)userNotificationCenter:(UNUserNotificationCenter *)center
       willPresentNotification:(UNNotification *)notification
         withCompletionHandler:(void (^)(UNNotificationPresentationOptions options))completionHandler {
    (void)center;
    (void)notification;
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
    completionHandler(UNNotificationPresentationOptionAlert |
                      UNNotificationPresentationOptionSound);
#pragma clang diagnostic pop
}
@end

static FolioNotificationDelegate *folio_notification_delegate = nil;

void folio_notifications_initialize(void) {
    if (folio_notifications_available()) {
        folio_notification_delegate = [[FolioNotificationDelegate alloc] init];
        [UNUserNotificationCenter currentNotificationCenter].delegate =
            folio_notification_delegate;
    }
}

int folio_notifications_authorization_status(void) {
    if (!folio_notifications_available()) return -1;
    __block NSInteger result = -1;
    dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
    [[UNUserNotificationCenter currentNotificationCenter]
        getNotificationSettingsWithCompletionHandler:^(UNNotificationSettings *settings) {
          switch (settings.authorizationStatus) {
            case UNAuthorizationStatusNotDetermined: result = 0; break;
            case UNAuthorizationStatusDenied: result = 1; break;
            case UNAuthorizationStatusAuthorized: result = 2; break;
            case UNAuthorizationStatusProvisional: result = 3; break;
#if TARGET_OS_IOS && __IPHONE_OS_VERSION_MAX_ALLOWED >= 140000
            case UNAuthorizationStatusEphemeral: result = 4; break;
#endif
            default: result = -1; break;
          }
          dispatch_semaphore_signal(semaphore);
        }];
    if (dispatch_semaphore_wait(semaphore,
            dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC)) != 0) return -1;
    return (int)result;
}

int folio_notifications_request_authorization(char **error_out) {
    if (!folio_notifications_available()) {
        folio_set_error(error_out, @"System notifications are unavailable.");
        return -1;
    }
    __block int result = -1;
    __block NSString *message = nil;
    dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
    [[UNUserNotificationCenter currentNotificationCenter]
        requestAuthorizationWithOptions:(UNAuthorizationOptionAlert |
                                         UNAuthorizationOptionSound)
        completionHandler:^(BOOL granted, NSError *error) {
          if (error != nil) message = error.localizedDescription;
          result = error == nil ? (granted ? 1 : 0) : -1;
          dispatch_semaphore_signal(semaphore);
        }];
    if (dispatch_semaphore_wait(semaphore,
            dispatch_time(DISPATCH_TIME_NOW, 60 * NSEC_PER_SEC)) != 0) {
        folio_set_error(error_out, @"Notification permission request timed out.");
        return -1;
    }
    if (result < 0) folio_set_error(error_out, message ?: @"Unable to request notifications.");
    return result;
}

int folio_notifications_schedule(const char *identifier,
                                 int year, int month, int day, int hour,
                                 const char *title, const char *body,
                                 char **error_out) {
    if (!folio_notifications_available()) {
        folio_set_error(error_out, @"System notifications are unavailable.");
        return -1;
    }
    if (!identifier || !title || !body) {
        folio_set_error(error_out, @"Notification content is invalid.");
        return -1;
    }
    NSString *requestIdentifier = [NSString stringWithUTF8String:identifier];
    NSString *notificationTitle = [NSString stringWithUTF8String:title];
    NSString *notificationBody = [NSString stringWithUTF8String:body];
    if (!requestIdentifier || !notificationTitle || !notificationBody) {
        folio_set_error(error_out, @"Notification content is not valid UTF-8.");
        return -1;
    }

    UNMutableNotificationContent *content = [[UNMutableNotificationContent alloc] init];
    content.title = notificationTitle;
    content.body = notificationBody;
    content.sound = [UNNotificationSound defaultSound];
    content.threadIdentifier = @"folio-financial-reminders";

    NSDateComponents *components = [[NSDateComponents alloc] init];
    components.calendar = [NSCalendar calendarWithIdentifier:NSCalendarIdentifierGregorian];
    components.timeZone = [NSTimeZone localTimeZone];
    components.year = year;
    components.month = month;
    components.day = day;
    components.hour = hour;
    components.minute = 0;
    UNCalendarNotificationTrigger *trigger =
        [UNCalendarNotificationTrigger triggerWithDateMatchingComponents:components repeats:NO];
    UNNotificationRequest *request =
        [UNNotificationRequest requestWithIdentifier:requestIdentifier
                                             content:content
                                             trigger:trigger];

    __block NSError *scheduleError = nil;
    dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
    [[UNUserNotificationCenter currentNotificationCenter]
        addNotificationRequest:request withCompletionHandler:^(NSError *error) {
          scheduleError = error;
          dispatch_semaphore_signal(semaphore);
        }];
    if (dispatch_semaphore_wait(semaphore,
            dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC)) != 0) {
        folio_set_error(error_out, @"Scheduling the notification timed out.");
        return -1;
    }
    if (scheduleError != nil) {
        folio_set_error(error_out, scheduleError.localizedDescription);
        return -1;
    }
    return 1;
}

void folio_notifications_cancel(const char *identifier) {
    if (!folio_notifications_available() || !identifier) return;
    NSString *value = [NSString stringWithUTF8String:identifier];
    if (!value) return;
    [[UNUserNotificationCenter currentNotificationCenter]
        removePendingNotificationRequestsWithIdentifiers:@[value]];
    [[UNUserNotificationCenter currentNotificationCenter]
        removeDeliveredNotificationsWithIdentifiers:@[value]];
}

void folio_notifications_free_string(char *value) {
    if (value != NULL) free(value);
}
