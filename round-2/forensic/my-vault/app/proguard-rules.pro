# Project R8 rules for release builds.

# Keep metadata used by Kotlin, Compose previews/tooling metadata, and generic
# signatures that libraries may inspect at runtime.
-keepattributes Signature, InnerClasses, EnclosingMethod
-keepattributes RuntimeVisibleAnnotations, RuntimeVisibleParameterAnnotations, AnnotationDefault

# Preserve native method names for dependencies that bind Java/Kotlin classes to
# packaged native libraries.
-keepclasseswithmembernames,includedescriptorclasses class * {
    native <methods>;
}

# OkHttp supports optional TLS providers that are not packaged with the app.
-dontwarn org.bouncycastle.**
-dontwarn org.conscrypt.**
-dontwarn org.openjsse.**
