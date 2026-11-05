# syntax=docker/dockerfile:1.7
# Targets: dev (spring-boot:run + devtools) · prod (JRE, jar, usuario no root)
ARG JAVA_VERSION=21
FROM eclipse-temurin:${JAVA_VERSION}-jdk AS base
WORKDIR /app
COPY mvnw pom.xml ./
COPY .mvn .mvn
RUN chmod +x mvnw

FROM base AS dev
COPY src src
EXPOSE 8080
CMD ["./mvnw", "-q", "spring-boot:run"]

FROM base AS build
RUN --mount=type=cache,target=/root/.m2 ./mvnw -q -B dependency:go-offline
COPY src src
RUN --mount=type=cache,target=/root/.m2 ./mvnw -q -B -DskipTests package \
 && cp "$(ls target/*.jar | grep -v -- '-plain' | head -1)" /app/app.jar

FROM eclipse-temurin:${JAVA_VERSION}-jre AS prod
RUN useradd --system --uid 1001 --no-create-home app
WORKDIR /app
COPY --from=build /app/app.jar app.jar
USER app
EXPOSE 8080
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=75 -XX:+ExitOnOutOfMemoryError"
HEALTHCHECK --interval=15s --timeout=3s --start-period=40s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/actuator/health >/dev/null || exit 1
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
