# Android 离线调试构建

`MainActivity`将打包assets下的网页映射至本地HTTPS源`appassets.androidplatform.net`，阻断其它请求。APK没有INTERNET权限，无任意文件访问、无JavaScript/native密钥桥；Three.js及全部资源离线内置。横屏、硬件加速、沉浸栏、暂停定时器、恢复与退出确认已包含。

在工程目录运行：

```powershell
& 'C:\Users\35338\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' android/build.py
```

构建使用本机Android SDK build-tools 35.0.1、JDK；平台jar默认`work/android-platform/android.jar`，可通过`ANDROID_JAR`环境变量改为其它已安装API24或更新版本。平台jar从Google官方`platform-35_r02.zip`获取，不需要Gradle或运行时网络。只有index.html、style.css、src/、vendor/、assets/进入APK，不打包测试、文档、工作目录和凭据。

输出`builds/autumn-ruins-debug.apk`及build-report.json。此包为调试签名，密钥只存workspace的work/android-build/debug.keystore，用于本地模拟器原型验证；不是商店发布签名。`targetSdkVersion=28`为当前原型兼容配置，正式发布前需要迁移当时要求的target SDK并再次测试安全区和生命周期。

官方依据：https://developer.android.com/develop/ui/views/layout/webapps/load-local-content ，https://developer.android.com/reference/android/webkit/WebViewClient
