#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>

static NSString *sessionDir, *eventsPath, *metadataPath, *stopPath, *cancelPath, *heartbeatPath;
static NSFileHandle *eventHandle;
static NSDate *startedAt;
static NSInteger nextID = 1;
static NSTimeInterval maxDuration = 1800;
static NSString *lastWindowSignature = @"";
static NSString *lastWindowTree = @"";
static NSString *lastFocusSignature = @"";
static NSMutableArray *monitors;
static BOOL ending = NO;
static BOOL accessibilityTrusted = NO;
static NSPanel *controlsPanel;
static NSTextField *elapsedLabel;
static AXUIElementRef systemWideElement;
static BOOL pointerDown = NO;
static BOOL pointerDragged = NO;
static CGPoint pointerStart;
static NSInteger pointerButton = 0;
static NSDictionary *pointerTarget;
static NSDictionary *pointerApp;

static void Finish(NSString *reason);

@interface RecordingControls : NSObject
- (void)stopRecording:(id)sender;
- (void)cancelRecording:(id)sender;
@end

@implementation RecordingControls
- (void)stopRecording:(id)sender { Finish(@"recording_controls_stopped"); }
- (void)cancelRecording:(id)sender { Finish(@"recording_controls_cancelled"); }
@end

static RecordingControls *controls;

static NSString *ISODate(NSDate *date) {
    static NSISO8601DateFormatter *formatter;
    static dispatch_once_t once;
    dispatch_once(&once, ^{ formatter = [NSISO8601DateFormatter new]; });
    return [formatter stringFromDate:date];
}

static void WriteObject(NSDictionary *object, NSString *path) {
    NSData *data = [NSJSONSerialization dataWithJSONObject:object options:NSJSONWritingPrettyPrinted | NSJSONWritingSortedKeys error:nil];
    [data writeToFile:path atomically:YES];
}

static void AppendEvent(NSString *kind, NSDictionary *payload) {
    NSMutableDictionary *event = [@{ @"id": @(nextID++), @"kind": kind, @"timestamp": ISODate([NSDate date]) } mutableCopy];
    [event addEntriesFromDictionary:payload ?: @{}];
    NSData *data = [NSJSONSerialization dataWithJSONObject:event options:NSJSONWritingSortedKeys error:nil];
    [eventHandle writeData:data];
    [eventHandle writeData:[@"\n" dataUsingEncoding:NSUTF8StringEncoding]];
    [eventHandle synchronizeFile];
}

static void UpdateHeartbeat(void) {
    [@"alive" writeToFile:heartbeatPath atomically:YES encoding:NSUTF8StringEncoding error:nil];
}

static NSString *AXString(AXUIElementRef element, CFStringRef attribute) {
    CFTypeRef value = NULL;
    if (AXUIElementCopyAttributeValue(element, attribute, &value) != kAXErrorSuccess || !value) return nil;
    id object = CFBridgingRelease(value);
    return [object isKindOfClass:NSString.class] ? object : [object description];
}

static NSDictionary *AXElementDescription(AXUIElementRef element, BOOL includeValue) {
    if (!element) return @{};
    NSString *role = AXString(element, kAXRoleAttribute) ?: @"";
    NSString *subrole = AXString(element, kAXSubroleAttribute) ?: @"";
    NSString *title = AXString(element, kAXTitleAttribute) ?: AXString(element, kAXDescriptionAttribute) ?: @"";
    NSString *identifier = AXString(element, kAXIdentifierAttribute) ?: @"";
    BOOL secure = [role isEqualToString:@"AXSecureTextField"] || [subrole.lowercaseString containsString:@"secure"];
    NSMutableDictionary *result = [@{
        @"role": role,
        @"subrole": subrole,
        @"title": title,
        @"identifier": identifier,
        @"secure": @(secure)
    } mutableCopy];
    if (includeValue) result[@"value"] = secure ? @"<redacted>" : (AXString(element, kAXValueAttribute) ?: @"");
    CFTypeRef positionValue = NULL, sizeValue = NULL;
    CGPoint position = CGPointZero;
    CGSize size = CGSizeZero;
    if (AXUIElementCopyAttributeValue(element, kAXPositionAttribute, &positionValue) == kAXErrorSuccess && positionValue) {
        AXValueGetValue(positionValue, kAXValueCGPointType, &position);
        CFRelease(positionValue);
    }
    if (AXUIElementCopyAttributeValue(element, kAXSizeAttribute, &sizeValue) == kAXErrorSuccess && sizeValue) {
        AXValueGetValue(sizeValue, kAXValueCGSizeType, &size);
        CFRelease(sizeValue);
    }
    result[@"frame"] = @{ @"x": @(position.x), @"y": @(position.y), @"width": @(size.width), @"height": @(size.height) };
    return result;
}

static NSDictionary *FrontmostApplicationDescription(void) {
    NSRunningApplication *app = NSWorkspace.sharedWorkspace.frontmostApplication;
    if (!app) return @{};
    return @{ @"name": app.localizedName ?: @"Unknown", @"bundleIdentifier": app.bundleIdentifier ?: @"", @"pid": @(app.processIdentifier) };
}

static NSDictionary *ApplicationDescriptionForElement(AXUIElementRef element) {
    pid_t pid = 0;
    if (element && AXUIElementGetPid(element, &pid) == kAXErrorSuccess && pid > 0) {
        NSRunningApplication *app = [NSRunningApplication runningApplicationWithProcessIdentifier:pid];
        if (app) return @{ @"name": app.localizedName ?: @"Unknown", @"bundleIdentifier": app.bundleIdentifier ?: @"", @"pid": @(pid) };
    }
    return FrontmostApplicationDescription();
}

static AXUIElementRef FocusedElement(void) {
    NSRunningApplication *app = NSWorkspace.sharedWorkspace.frontmostApplication;
    if (!app) return NULL;
    AXUIElementRef appElement = AXUIElementCreateApplication(app.processIdentifier);
    CFTypeRef focused = NULL;
    AXError error = AXUIElementCopyAttributeValue(appElement, kAXFocusedUIElementAttribute, &focused);
    CFRelease(appElement);
    return error == kAXErrorSuccess ? (AXUIElementRef)focused : NULL;
}

static void FlattenAX(AXUIElementRef element, NSInteger depth, NSInteger *remaining, NSMutableArray<NSString *> *lines) {
    if (*remaining <= 0 || depth >= 9) return;
    (*remaining)--;
    NSString *role = AXString(element, kAXRoleAttribute) ?: @"element";
    NSString *subrole = AXString(element, kAXSubroleAttribute) ?: @"";
    BOOL secure = [role isEqualToString:@"AXSecureTextField"] || [subrole.lowercaseString containsString:@"secure"];
    NSString *title = AXString(element, kAXTitleAttribute) ?: AXString(element, kAXDescriptionAttribute);
    if (!title) title = secure ? @"<redacted>" : (AXString(element, kAXValueAttribute) ?: @"");
    [lines addObject:[NSString stringWithFormat:@"%@%@ %@", [@"\t" stringByPaddingToLength:depth withString:@"\t" startingAtIndex:0], role, title]];
    CFTypeRef value = NULL;
    if (AXUIElementCopyAttributeValue(element, kAXChildrenAttribute, &value) != kAXErrorSuccess || !value) return;
    NSArray *children = CFBridgingRelease(value);
    if (![children isKindOfClass:NSArray.class]) return;
    for (id child in [children subarrayWithRange:NSMakeRange(0, MIN(children.count, 80))]) {
        FlattenAX((__bridge AXUIElementRef)child, depth + 1, remaining, lines);
        if (*remaining <= 0) break;
    }
}

static NSString *AXTreeDiff(NSString *previous, NSString *current) {
    NSArray<NSString *> *oldLines = [previous componentsSeparatedByString:@"\n"];
    NSArray<NSString *> *newLines = [current componentsSeparatedByString:@"\n"];
    NSUInteger prefix = 0;
    while (prefix < oldLines.count && prefix < newLines.count && [oldLines[prefix] isEqualToString:newLines[prefix]]) prefix++;
    NSUInteger suffix = 0;
    while (suffix + prefix < oldLines.count && suffix + prefix < newLines.count &&
           [oldLines[oldLines.count - suffix - 1] isEqualToString:newLines[newLines.count - suffix - 1]]) suffix++;
    NSRange oldRange = NSMakeRange(prefix, oldLines.count - prefix - suffix);
    NSRange newRange = NSMakeRange(prefix, newLines.count - prefix - suffix);
    NSArray<NSString *> *removed = [oldLines subarrayWithRange:oldRange];
    NSArray<NSString *> *added = [newLines subarrayWithRange:newRange];
    NSMutableArray<NSString *> *diff = [NSMutableArray array];
    if (removed.count == added.count) {
        for (NSUInteger i = 0; i < removed.count; i++) [diff addObject:[NSString stringWithFormat:@"~ %@ => %@", removed[i], added[i]]];
    } else {
        for (NSString *line in removed) [diff addObject:[@"- " stringByAppendingString:line]];
        for (NSString *line in added) [diff addObject:[@"+ " stringByAppendingString:line]];
    }
    return [diff componentsJoinedByString:@"\n"];
}

static void CaptureWindow(void) {
    NSRunningApplication *app = NSWorkspace.sharedWorkspace.frontmostApplication;
    if (!app) return;
    AXUIElementRef appElement = AXUIElementCreateApplication(app.processIdentifier);
    CFTypeRef value = NULL;
    if (AXUIElementCopyAttributeValue(appElement, kAXFocusedWindowAttribute, &value) != kAXErrorSuccess || !value) { CFRelease(appElement); return; }
    AXUIElementRef window = (AXUIElementRef)value;
    NSString *title = AXString(window, kAXTitleAttribute) ?: @"";
    NSString *signature = [NSString stringWithFormat:@"%d|%@", app.processIdentifier, title];
    NSInteger remaining = 500;
    NSMutableArray *lines = [NSMutableArray array];
    FlattenAX(window, 0, &remaining, lines);
    NSString *tree = [lines componentsJoinedByString:@"\n"];
    BOOL windowChanged = ![signature isEqualToString:lastWindowSignature];
    if (windowChanged || ![tree isEqualToString:lastWindowTree]) {
        NSString *payload = windowChanged ? tree : AXTreeDiff(lastWindowTree, tree);
        lastWindowSignature = signature;
        lastWindowTree = tree;
        AppendEvent(@"window.changed", @{
            @"app": @{ @"name": app.localizedName ?: @"Unknown", @"bundleIdentifier": app.bundleIdentifier ?: @"" },
            @"window": @{ @"title": title },
            @"ax": @{ @"mode": windowChanged ? @"fullTree" : @"diffFromPrevious", @"text": payload }
        });
    }
    AXUIElementRef focused = FocusedElement();
    NSDictionary *focusDescription = AXElementDescription(focused, YES);
    if (focused) CFRelease(focused);
    NSData *focusData = [NSJSONSerialization dataWithJSONObject:focusDescription options:NSJSONWritingSortedKeys error:nil];
    NSString *focusSignature = [[NSString alloc] initWithData:focusData encoding:NSUTF8StringEncoding] ?: @"";
    if (![focusSignature isEqualToString:lastFocusSignature]) {
        lastFocusSignature = focusSignature;
        AppendEvent(@"selection.changed", @{ @"app": FrontmostApplicationDescription(), @"target": focusDescription });
    }
    CFRelease(window);
    CFRelease(appElement);
}

static NSDictionary *Metadata(NSString *reason) {
    NSMutableDictionary *data = [@{
        @"id": sessionDir.lastPathComponent,
        @"startedAt": ISODate(startedAt),
        @"eventsPath": eventsPath,
        @"accessibilityTrusted": @(accessibilityTrusted)
    } mutableCopy];
    if (reason) { data[@"endedAt"] = ISODate([NSDate date]); data[@"endReason"] = reason; }
    return data;
}

static void Finish(NSString *reason) {
    if (ending) return;
    ending = YES;
    AppendEvent(@"session.ended", @{ @"endReason": reason ?: @"unknown" });
    WriteObject(Metadata(reason), metadataPath);
    [controlsPanel orderOut:nil];
    for (id monitor in monitors) [NSEvent removeMonitor:monitor];
    [eventHandle closeFile];
    if (systemWideElement) { CFRelease(systemWideElement); systemWideElement = NULL; }
    if ([reason isEqualToString:@"recording_controls_cancelled"] || [reason isEqualToString:@"accessibility_permission_required"]) {
        [NSFileManager.defaultManager removeItemAtPath:eventsPath error:nil];
        [NSFileManager.defaultManager removeItemAtPath:heartbeatPath error:nil];
    }
    [NSApp stop:nil];
    exit(0);
}

static void ShowControls(void) {
    [NSApplication sharedApplication];
    [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
    [NSApp finishLaunching];
    NSRect screen = NSScreen.mainScreen.visibleFrame;
    NSRect frame = NSMakeRect(NSMaxX(screen) - 350, NSMaxY(screen) - 108, 330, 76);
    controlsPanel = [[NSPanel alloc] initWithContentRect:frame
                                               styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskNonactivatingPanel | NSWindowStyleMaskUtilityWindow
                                                 backing:NSBackingStoreBuffered
                                                   defer:NO];
    controlsPanel.title = @"FlowOnce";
    controlsPanel.level = NSFloatingWindowLevel;
    controlsPanel.collectionBehavior = NSWindowCollectionBehaviorCanJoinAllSpaces | NSWindowCollectionBehaviorFullScreenAuxiliary;
    controlsPanel.hidesOnDeactivate = NO;
    controls = [RecordingControls new];

    NSTextField *label = [NSTextField labelWithString:@"FlowOnce is recording your actions"];
    label.frame = NSMakeRect(16, 42, 200, 20);
    [controlsPanel.contentView addSubview:label];
    elapsedLabel = [NSTextField labelWithString:@"00:00 · up to 30 minutes"];
    elapsedLabel.textColor = NSColor.secondaryLabelColor;
    elapsedLabel.frame = NSMakeRect(16, 14, 190, 20);
    [controlsPanel.contentView addSubview:elapsedLabel];
    NSButton *stop = [NSButton buttonWithTitle:@"Stop" target:controls action:@selector(stopRecording:)];
    stop.frame = NSMakeRect(224, 38, 88, 28);
    [controlsPanel.contentView addSubview:stop];
    NSButton *cancel = [NSButton buttonWithTitle:@"Cancel" target:controls action:@selector(cancelRecording:)];
    cancel.frame = NSMakeRect(224, 8, 88, 28);
    [controlsPanel.contentView addSubview:cancel];
    [controlsPanel orderFrontRegardless];
    [controlsPanel orderFrontRegardless];
}

static void OpenAccessibilityPermissionSetup(void) {
    NSURL *appURL = NSBundle.mainBundle.bundleURL;
    [NSWorkspace.sharedWorkspace activateFileViewerSelectingURLs:@[appURL]];
    NSURL *settingsURL = [NSURL URLWithString:@"x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"];
    if (settingsURL) [NSWorkspace.sharedWorkspace openURL:settingsURL];
}

static BOOL RequestLocalRecordingConsent(void) {
    [NSApplication sharedApplication];
    [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
    [NSApp finishLaunching];
    [NSApp activateIgnoringOtherApps:YES];
    NSAlert *alert = [NSAlert new];
    alert.messageText = @"Allow FlowOnce to record your actions on your Mac?";
    alert.informativeText = @"FlowOnce will record your mouse clicks, text you type, and the content in windows you interact with until you press Stop (up to 30 minutes). You can cancel any time.";
    [alert addButtonWithTitle:@"Allow once"];
    [alert addButtonWithTitle:@"Deny"];
    return [alert runModal] == NSAlertFirstButtonReturn;
}

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        BOOL headless = [[NSProcessInfo.processInfo.environment objectForKey:@"RECORD_REPLAY_HEADLESS"] isEqualToString:@"1"];
        BOOL forcePermissionRequired = [[NSProcessInfo.processInfo.environment objectForKey:@"RECORD_REPLAY_FORCE_ACCESSIBILITY_UNTRUSTED"] isEqualToString:@"1"];
        if (argc >= 3) {
            sessionDir = [NSString stringWithUTF8String:argv[1]];
            maxDuration = atof(argv[2]);
        } else {
            fprintf(stderr, "FlowOnce must be started by its supported local controller.\n");
            return 2;
        }
        eventsPath = [sessionDir stringByAppendingPathComponent:@"events.jsonl"];
        metadataPath = [sessionDir stringByAppendingPathComponent:@"session.json"];
        stopPath = [sessionDir stringByAppendingPathComponent:@"stop"];
        cancelPath = [sessionDir stringByAppendingPathComponent:@"cancel"];
        heartbeatPath = [sessionDir stringByAppendingPathComponent:@"heartbeat"];
        startedAt = [NSDate date];
        systemWideElement = AXUIElementCreateSystemWide();
        monitors = [NSMutableArray array];
        [NSFileManager.defaultManager createDirectoryAtPath:sessionDir withIntermediateDirectories:YES attributes:nil error:nil];
        BOOL requireLocalConsent = argc >= 4 && strcmp(argv[3], "--require-local-consent") == 0;
        if (requireLocalConsent) {
            BOOL accepted = RequestLocalRecordingConsent();
            WriteObject(@{ @"action": accepted ? @"accept" : @"decline" }, [sessionDir stringByAppendingPathComponent:@"consent.json"]);
            if (!accepted) return 3;
        }
        [NSFileManager.defaultManager createFileAtPath:eventsPath contents:nil attributes:nil];
        eventHandle = [NSFileHandle fileHandleForWritingAtPath:eventsPath];
        WriteObject(Metadata(nil), metadataPath);
        AppendEvent(@"session.started", nil);

        NSDictionary *trustOptions = @{ (__bridge NSString *)kAXTrustedCheckOptionPrompt: @(!headless) };
        accessibilityTrusted = forcePermissionRequired ? NO : (headless ? NO : AXIsProcessTrustedWithOptions((__bridge CFDictionaryRef)trustOptions));
        WriteObject(Metadata(nil), metadataPath);
        AppendEvent(@"permissions.checked", @{ @"accessibilityTrusted": @(accessibilityTrusted) });
        if (forcePermissionRequired || (!headless && !accessibilityTrusted)) {
            if (!headless) OpenAccessibilityPermissionSetup();
            Finish(@"accessibility_permission_required");
        }
        UpdateHeartbeat();
        if (headless) {
            // A Foundation run loop is sufficient for lifecycle tests.
        } else {
            ShowControls();
        }

        NSEventMask pointerMask = NSEventMaskLeftMouseDown | NSEventMaskRightMouseDown | NSEventMaskOtherMouseDown |
            NSEventMaskLeftMouseDragged | NSEventMaskRightMouseDragged | NSEventMaskOtherMouseDragged |
            NSEventMaskLeftMouseUp | NSEventMaskRightMouseUp | NSEventMaskOtherMouseUp;
        id mouse = headless ? nil : [NSEvent addGlobalMonitorForEventsMatchingMask:pointerMask handler:^(NSEvent *event) {
            NSPoint p = NSEvent.mouseLocation;
            CGPoint eventPoint = event.CGEvent ? CGEventGetLocation(event.CGEvent) : CGPointMake(p.x, p.y);
            BOOL isDown = event.type == NSEventTypeLeftMouseDown || event.type == NSEventTypeRightMouseDown || event.type == NSEventTypeOtherMouseDown;
            BOOL isDragged = event.type == NSEventTypeLeftMouseDragged || event.type == NSEventTypeRightMouseDragged || event.type == NSEventTypeOtherMouseDragged;
            BOOL isUp = event.type == NSEventTypeLeftMouseUp || event.type == NSEventTypeRightMouseUp || event.type == NSEventTypeOtherMouseUp;
            if (isDown) {
                AXUIElementRef target = NULL;
                AXUIElementCopyElementAtPosition(systemWideElement, eventPoint.x, eventPoint.y, &target);
                pointerTarget = AXElementDescription(target, YES);
                pointerApp = ApplicationDescriptionForElement(target);
                if (target) CFRelease(target);
                pointerStart = eventPoint;
                pointerButton = event.buttonNumber;
                pointerDragged = NO;
                pointerDown = YES;
                return;
            }
            if (isDragged && pointerDown) {
                CGFloat dx = eventPoint.x - pointerStart.x, dy = eventPoint.y - pointerStart.y;
                if (hypot(dx, dy) >= 3.0) pointerDragged = YES;
                return;
            }
            if (isUp && pointerDown) {
                NSDictionary *mousePayload = pointerDragged
                    ? @{ @"button": @(pointerButton), @"fromX": @(pointerStart.x), @"fromY": @(pointerStart.y), @"toX": @(eventPoint.x), @"toY": @(eventPoint.y) }
                    : @{ @"button": @(pointerButton), @"x": @(eventPoint.x), @"y": @(eventPoint.y), @"clickCount": @(event.clickCount) };
                AppendEvent(pointerDragged ? @"mouse.drag" : @"mouse.click", @{
                    @"mouse": mousePayload,
                    @"app": pointerApp ?: @{},
                    @"target": pointerTarget ?: @{}
                });
                pointerDown = NO;
                pointerDragged = NO;
                pointerTarget = nil;
                pointerApp = nil;
                CaptureWindow();
            }
        }];
        if (mouse) [monitors addObject:mouse];

        id scroll = headless ? nil : [NSEvent addGlobalMonitorForEventsMatchingMask:NSEventMaskScrollWheel handler:^(NSEvent *event) {
            NSPoint p = NSEvent.mouseLocation;
            CGPoint axPoint = event.CGEvent ? CGEventGetLocation(event.CGEvent) : CGPointMake(p.x, p.y);
            AXUIElementRef target = NULL;
            AXUIElementCopyElementAtPosition(systemWideElement, axPoint.x, axPoint.y, &target);
            NSDictionary *targetDescription = AXElementDescription(target, NO);
            NSDictionary *targetApp = ApplicationDescriptionForElement(target);
            if (target) CFRelease(target);
            AppendEvent(@"mouse.scroll", @{
                @"mouse": @{
                    @"x": @(axPoint.x), @"y": @(axPoint.y),
                    @"deltaX": @(event.scrollingDeltaX), @"deltaY": @(event.scrollingDeltaY),
                    @"precise": @(event.hasPreciseScrollingDeltas)
                },
                @"app": targetApp,
                @"target": targetDescription
            });
        }];
        if (scroll) [monitors addObject:scroll];

        id keyboard = headless ? nil : [NSEvent addGlobalMonitorForEventsMatchingMask:NSEventMaskKeyDown handler:^(NSEvent *event) {
            NSString *text = event.characters ?: @"";
            NSEventModifierFlags flags = event.modifierFlags & NSEventModifierFlagDeviceIndependentFlagsMask;
            AXUIElementRef focused = FocusedElement();
            NSDictionary *target = AXElementDescription(focused, NO);
            BOOL secure = [target[@"secure"] boolValue];
            if (focused) CFRelease(focused);
            NSDictionary *app = FrontmostApplicationDescription();
            if ((event.keyCode == 36 || event.keyCode == 76) && !(flags & NSEventModifierFlagCommand))
                AppendEvent(@"keyboard.submit", @{ @"keyboard": @{ @"keyCode": @(event.keyCode) }, @"app": app, @"target": target });
            else if (text.length == 1 && !(flags & (NSEventModifierFlagCommand | NSEventModifierFlagControl)))
                AppendEvent(@"keyboard.text_input", @{ @"keyboard": @{ @"text": secure ? @"<redacted>" : text, @"redacted": @(secure) }, @"app": app, @"target": target });
            else
                AppendEvent(@"keyboard.shortcut", @{ @"keyboard": @{
                    @"keyCode": @(event.keyCode),
                    @"modifiers": @(flags),
                    @"charactersIgnoringModifiers": event.charactersIgnoringModifiers ?: @""
                }, @"app": app, @"target": target });
            CaptureWindow();
        }];
        if (keyboard) [monitors addObject:keyboard];

        [NSTimer scheduledTimerWithTimeInterval:0.75 repeats:YES block:^(NSTimer *timer) {
            (void)timer;
            UpdateHeartbeat();
            NSInteger elapsed = (NSInteger)(-startedAt.timeIntervalSinceNow);
            elapsedLabel.stringValue = [NSString stringWithFormat:@"%02ld:%02ld · up to 30 minutes", (long)(elapsed / 60), (long)(elapsed % 60)];
            if ([NSFileManager.defaultManager fileExistsAtPath:cancelPath]) { Finish(@"recording_controls_cancelled"); return; }
            if ([NSFileManager.defaultManager fileExistsAtPath:stopPath]) { Finish(@"recording_controls_stopped"); return; }
            if (-startedAt.timeIntervalSinceNow >= maxDuration) { Finish(@"max_duration_reached"); return; }
            if (!headless) CaptureWindow();
        }];
        if (!headless) CaptureWindow();
        if (headless) [[NSRunLoop currentRunLoop] run];
        else [NSApp run];
    }
    return 0;
}
