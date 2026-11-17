# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Preserve line number attributes for clearer crash stack traces
-keepattributes SourceFile,LineNumberTable
-keepattributes *Annotation*

# Preserve Ryotunes Android entry points, Capacitor plugins, MediaService, and WidgetProvider
-keep class dev.ryoku.ryotunes.** { *; }

# Preserve Capacitor plugin annotations and bridge classes
-keep @com.getcapacitor.annotation.CapacitorPlugin public class * {
    @com.getcapacitor.annotation.PermissionCallback <methods>;
    @com.getcapacitor.annotation.ActivityCallback <methods>;
    @com.getcapacitor.annotation.Permission <methods>;
    @com.getcapacitor.PluginMethod public <methods>;
}
-keep public class * extends com.getcapacitor.Plugin { *; }
-keep class com.getcapacitor.** { *; }

# Media3 / ExoPlayer keep rules for audio focus, service binding, and playback
-keep class androidx.media3.** { *; }
-dontwarn androidx.media3.**
