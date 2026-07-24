#import <AppKit/AppKit.h>

static NSString *ReadPipe(NSPipe *pipe) {
    NSData *data = [pipe.fileHandleForReading readDataToEndOfFile];
    NSString *text = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
    return text ?: @"";
}

static void ShowFailure(NSString *message) {
    NSAlert *alert = [[NSAlert alloc] init];
    alert.alertStyle = NSAlertStyleCritical;
    alert.messageText = @"FlowOnce 安装失败";
    alert.informativeText = message.length ? message : @"安装器没有返回错误详情。";
    [alert addButtonWithTitle:@"关闭"];
    [alert runModal];
}

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        NSDictionary<NSString *, NSString *> *environment = NSProcessInfo.processInfo.environment;
        BOOL bootstrap = argc >= 2 && strcmp(argv[1], "--bootstrap") == 0;
        BOOL noUI = bootstrap || [environment[@"RECORD_REPLAY_INSTALL_NO_UI"] isEqualToString:@"1"];
        if (!noUI) {
            [NSApplication sharedApplication];
            [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
            [NSApp activateIgnoringOtherApps:YES];
        }

        NSString *resources = NSBundle.mainBundle.resourcePath;
        NSURL *nodeURL = [NSURL fileURLWithPath:[resources stringByAppendingPathComponent:@"payload/runtime/bin/node"]];
        NSString *installerPath = [resources stringByAppendingPathComponent:@"payload/product/scripts/install-distribution.mjs"];
        NSString *payloadPath = [resources stringByAppendingPathComponent:@"payload"];
        NSMutableArray<NSString *> *arguments = [NSMutableArray arrayWithArray:@[installerPath, @"--payload", payloadPath]];
        NSString *overrideHome = environment[@"RECORD_REPLAY_INSTALL_HOME"];
        NSString *overrideHosts = environment[@"RECORD_REPLAY_INSTALL_HOSTS"];
        if (overrideHome.length) [arguments addObjectsFromArray:@[@"--home", overrideHome]];
        if (overrideHosts.length) [arguments addObjectsFromArray:@[@"--hosts", overrideHosts]];
        if ([environment[@"RECORD_REPLAY_INSTALL_NO_SYSTEM_DETECT"] isEqualToString:@"1"]) {
            [arguments addObject:@"--no-system-detect"];
        }
        NSTask *task = [[NSTask alloc] init];
        NSPipe *standardOutput = [NSPipe pipe];
        NSPipe *standardError = [NSPipe pipe];
        task.executableURL = nodeURL;
        task.arguments = arguments;
        task.standardOutput = standardOutput;
        task.standardError = standardError;

        NSError *launchError = nil;
        if (![task launchAndReturnError:&launchError]) {
            if (noUI) fprintf(stderr, "%s\n", launchError.localizedDescription.UTF8String);
            else ShowFailure(launchError.localizedDescription);
            return 1;
        }
        [task waitUntilExit];
        NSString *output = ReadPipe(standardOutput);
        NSString *error = ReadPipe(standardError);
        if (task.terminationStatus != 0) {
            NSString *message = error.length ? error : output;
            if (noUI) fprintf(stderr, "%s\n", message.UTF8String);
            else ShowFailure(message);
            return task.terminationStatus;
        }

        if (noUI) {
            fprintf(stdout, "%s", output.UTF8String);
            return 0;
        }

        NSAlert *alert = [[NSAlert alloc] init];
        alert.alertStyle = NSAlertStyleInformational;
        alert.messageText = @"FlowOnce 已安装";
        alert.informativeText = [NSString stringWithFormat:@"%@\n接下来需要您本人允许 macOS“辅助功能”权限。", output];
        [alert addButtonWithTitle:@"打开辅助功能设置"];
        [alert addButtonWithTitle:@"稍后"];
        NSModalResponse response = [alert runModal];
        if (response == NSAlertFirstButtonReturn) {
            NSURL *settingsURL = [NSURL URLWithString:@"x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"];
            [NSWorkspace.sharedWorkspace openURL:settingsURL];
            NSString *recorderPath = [NSHomeDirectory() stringByAppendingPathComponent:@"Applications/FlowOnce.app"];
            [NSWorkspace.sharedWorkspace activateFileViewerSelectingURLs:@[[NSURL fileURLWithPath:recorderPath]]];
        }
        return 0;
    }
}
