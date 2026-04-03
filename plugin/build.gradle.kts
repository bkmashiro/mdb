plugins {
    java
    id("com.gradleup.shadow") version "8.3.0"
}

group = "dev.mdb"
version = "0.1.0-SNAPSHOT"

java {
    toolchain.languageVersion.set(JavaLanguageVersion.of(21))
}

repositories {
    mavenCentral()
    maven("https://repo.papermc.io/repository/maven-public/")
}

dependencies {
    compileOnly("io.papermc.paper:paper-api:1.21.4-R0.1-SNAPSHOT")
    // Brigadier (CommandDispatcher) — included transitively via paper-api but declared explicitly
    compileOnly("com.mojang:brigadier:1.3.10")
    // WebSocket client (connects to mdb server)
    implementation("org.java-websocket:Java-WebSocket:1.5.6")
    // JSON
    implementation("com.google.code.gson:gson:2.10.1")
}

tasks {
    compileJava {
        options.encoding = "UTF-8"
        options.release.set(21)
    }

    shadowJar {
        archiveClassifier.set("")
        relocate("org.java_websocket", "dev.mdb.shaded.websocket")
        relocate("com.google.gson", "dev.mdb.shaded.gson")
    }

    build {
        dependsOn(shadowJar)
    }
}
