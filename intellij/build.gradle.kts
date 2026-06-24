import org.jetbrains.intellij.platform.gradle.IntelliJPlatformType
import org.jetbrains.intellij.platform.gradle.TestFrameworkType

// Omnigent IntelliJ/PyCharm plugin — Phase B (B1).
//
// Uses the IntelliJ Platform Gradle Plugin v2 (org.jetbrains.intellij.platform).
// Kotlin/JVM. Targets IDEA + PyCharm (Community + Professional). The plugin
// jar's discovery/auth/config logic is PURE (no IDE APIs) so the conformance
// + unit tests run on a plain JUnit5 JVM without bootstrapping an IDE.

plugins {
    // Kotlin 2.2 to match the stdlib bundled by the 253 platform (its metadata
    // version is 2.2.0; an older compiler cannot read it).
    kotlin("jvm") version "2.2.0"
    kotlin("plugin.serialization") version "2.2.0"
    id("org.jetbrains.intellij.platform") version "2.16.0"
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
        // NOT defaultRepositories(): that adds the JetBrains Marketplace repo
        // (cache-redirector -> plugins.jetbrains.com), which is unreachable in
        // proxied/sandboxed environments. A connection-refused while listing
        // versions there is FATAL and aborts resolution before the reachable
        // intellij-repository is tried — breaking both buildPlugin (when
        // instrumentation is on) and `test`'s test-framework resolution.
        // This plugin has no third-party Marketplace plugin dependencies, so we
        // enumerate the platform repositories WITHOUT marketplace(). The
        // platform SDK, test-framework, and instrumentation tools all resolve
        // from intellij-repository releases/snapshots + intellij-dependencies,
        // which are reachable via cache-redirector.
        localPlatformArtifacts()
        releases()
        snapshots()
        intellijDependencies()
        jetbrainsRuntime()
    }
}

// Single source-of-truth target platform pins (B1 / plan Q3).
val platformType = providers.gradleProperty("platformType").getOrElse("IC")
val platformVersion = providers.gradleProperty("platformVersion").getOrElse("2024.1")

dependencies {
    // kotlinx.serialization for the shared conformance JSON vectors (kept
    // untouched; loaded identically to the TS suite).
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")

    intellijPlatform {
        // Target the 253 platform — see gradle.properties.
        // Switch platformType=PC (PyCharm Community) / PY (PyCharm Professional) /
        // IU (IDEA Ultimate) via gradle.properties to build/verify the other IDEs.
        // useInstaller=false resolves the SDK artifact from the intellij-repository
        // (maven layout) by build number, instead of a full IDE installer.
        create {
            type = IntelliJPlatformType.fromCode(platformType)
            version = platformVersion
            useInstaller = false
        }

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
    // start (NoClassDefFoundError: junit/framework/TestCase). On the COMPILE
    // classpath too (not just runtime) so BasePlatformTestCase's JUnit3/4
    // `TestCase` supertype + assert* helpers resolve for the Phase 3 platform test.
    testImplementation("junit:junit:4.13.2")
    // BasePlatformTestCase is JUnit3/4-based; under useJUnitPlatform() it is only
    // DISCOVERED via the JUnit4 vintage engine. Pinned to the junit-bom (5.10.2)
    // so the engine version tracks the jupiter version. Without this the Phase 3
    // SessionsServiceTest (a BasePlatformTestCase) would never be collected/run.
    testRuntimeOnly("org.junit.vintage:junit-vintage-engine")
}

intellijPlatform {
    // This is a pure-Kotlin plugin: no Java sources and no .form GUI files, so
    // there is nothing for the IntelliJ code instrumenter to do (@NotNull
    // bytecode instrumentation + .form compilation are Java-only). Disabling it
    // also drops the com.jetbrains.intellij.java:java-compiler-ant-tasks
    // dependency, which is only resolvable from the JetBrains Marketplace
    // (plugins.jetbrains.com) — unreachable in proxied/sandboxed environments.
    instrumentCode = false

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
