# syntax=docker/dockerfile:1.7

# ---- build stage ----
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /src
COPY pom.xml .
RUN mvn -B -q dependency:go-offline
COPY src ./src
RUN mvn -B -q package -DskipTests

# ---- runtime stage ----
FROM eclipse-temurin:21-jre
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /src/target/prompt-shield.jar /app/app.jar

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS http://localhost:8080/actuator/health | grep -q '"UP"' || exit 1

ENTRYPOINT ["java","-XX:MaxRAMPercentage=75","-jar","/app/app.jar"]
