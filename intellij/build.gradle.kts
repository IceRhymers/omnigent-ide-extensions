import org.jetbrains.intellij.platform.gradle.IntelliJPlatformType
import org.jetbrains.intellij.platform.gradle.TestFrameworkType

// Omnigent IntelliJ/PyCharm plugin — Phase B (B1).
//
// Uses the IntelliJ Platform Gradle Plugin v2 (org.jetbrains.intellij.platform).
// Kotlin/JVM. Targets IDEA + PyCharm (Community + Professional). The plugin
// jar's discovery/auth/config logic is PURE (no IDE APIs) so the conformance
// + unit tests run on a plain JUnit5 JVM without bootstrapping an IDE.

plugins {
    kotlin("jvm") version "1.9.24"
    kotlin("plugin.serialization") version "1.9.24"
    id("org.jetbrains.intellij.platform") version "2.1.0"
}

group = "ai.omnigent"
version = providers.gradleProperty("pluginVersion").getOrElse("0.1.0")

val useCacheRedirector = (providers.gradleProperty("useCacheRedirector").orNull == "true")

repositories {
    if (useCacheRedirector) {
        // Sandbox-only: route through JetBrains cache-redirector (see settings.gradle.kts).
        maven("https://cache-redirector.jetbrains.com/maven-central")
        maven("https://cache-redirector.jetbrains.com/intellij-dependencies")
    } else {
        mavenCentral()
    }
    intellijPlatform {
        defaultRepositories()
    }
}

// Single source-of-truth target platform pins (B1 / plan Q3).
val platformType = providers.gradleProperty("platformType").getOrElse("IC")
val platformVersion = providers.gradleProperty("platformVersion").getOrElse("2024.1")

dependencies {
    // kotlinx.serialization for the shared conformance JSON vectors (kept
    // untouched; loaded identically to the TS suite).
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.6.3")

    intellijPlatform {
        // Default target: IDEA Community 2024.1 (sinceBuild 241, JCEF-capable JBR).
        // Switch platformType=PC (PyCharm Community) / PY (PyCharm Professional) /
        // IU (IDEA Ultimate) via gradle.properties to build/verify the other IDEs.
        create(IntelliJPlatformType.fromCode(platformType), platformVersion)

        // Java compiler used by the :instrumentCode task (form/nullability
        // instrumentation). Required by the IntelliJ Platform Gradle Plugin v2
        // even though our code is pure Kotlin; pulled from intellijDependencies()
        // which defaultRepositories() includes.
        instrumentationTools()

        // Bundled test framework (platform + JUnit4 harness IntelliJ ships).
        testFramework(TestFrameworkType.Platform)
    }

    // Plain JUnit5 for the pure conformance/unit suites (no IDE host needed).
    testImplementation(platform("org.junit:junit-bom:5.10.2"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
    // kotlin.test assertions (assertEquals/assertTrue/assertNull/...) used by the
    // conformance + unit suites, backed by the JUnit5 platform engine.
    testImplementation(kotlin("test"))
    // JUnit4 must be present because the IntelliJ Platform test framework
    // registers a JUnit Platform LauncherSessionListener
    // (com.intellij.tests.JUnit5TestSessionListener) that references
    // junit.framework.TestCase; without it the Gradle test executor fails to
    // start (NoClassDefFoundError: junit/framework/TestCase).
    testRuntimeOnly("junit:junit:4.13.2")
}

intellijPlatform {
    pluginConfiguration {
        version = project.version.toString()
        // sinceBuild is pinned from gradle.properties. untilBuild must be set to
        // null EXPLICITLY for an open upper bound: the IntelliJ Platform Gradle
        // Plugin v2 otherwise auto-derives untilBuild as "<branch>.*" of the build
        // platform (e.g. 241.*), which wrongly blocks newer IDEs (PY/IC 253+).
        // The plugin uses only stable APIs (tool window, JCEF, actions), so an
        // open upper bound is the intended reach-over-safety choice.
        ideaVersion {
            sinceBuild = providers.gradleProperty("sinceBuild").getOrElse("241")
            untilBuild = provider { null }
        }
    }
}

kotlin {
    jvmToolchain(17)
}

tasks.test {
    useJUnitPlatform()
}
