// Settings for the Omnigent IntelliJ/PyCharm plugin (Phase B).
//
// Repositories are declared at the PROJECT level (build.gradle.kts) via the
// IntelliJ Platform Gradle Plugin's `intellijPlatform { defaultRepositories() }`
// helper. We deliberately do NOT use the optional settings plugin
// (`org.jetbrains.intellij.platform.settings`) here — the project-level
// declaration is sufficient and avoids coupling settings-script compilation to
// that plugin's extension surface.
//
// Maven Central is reached through a user-global mirror (see
// ~/.gradle/init.d/databricks-maven-mirror.gradle); the mirror URL is NOT
// hard-coded in this repo. `gradlePluginPortal()`/`mavenCentral()` below are
// transparently redirected by that init script when needed.

pluginManagement {
    repositories {
        gradlePluginPortal()
        mavenCentral()
    }
}

rootProject.name = "omnigent-intellij"
