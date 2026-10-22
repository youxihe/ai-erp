# Build-context: repository root (ai-erp/)
FROM maven:3.9.6-eclipse-temurin-8 AS build
WORKDIR /src
# Prefer Maven Central only (avoid dead spring milestone / bintray mirrors).
COPY deploy/scripts/maven-central-settings.xml /root/.m2/settings.xml
COPY jshERP-boot/pom.xml ./pom.xml
COPY jshERP-boot/src ./src
# Upstream pom sets maven-compiler-plugin skip=true (IDE workflow).
# Force compilation here and use finalName=jshERP from pom.xml.
RUN mvn -B -DskipTests -Dmaven.compiler.skip=false package \
    && test -f target/jshERP.jar \
    && cp target/jshERP.jar /src/app.jar

FROM eclipse-temurin:8-jre
WORKDIR /app
# Chinese fonts for AIERP-015B purchase receipt PDF (A4). Not bundled in Git.
RUN apt-get update \
    && apt-get install -y --no-install-recommends fonts-wqy-microhei fontconfig \
    && fc-cache -f \
    && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /opt/tmp/tomcat /opt/jshERP/upload /opt/jshERP/export /opt/jshERP/receipts \
    /app/data/tomcat /app/data/upload /app/data/export
COPY --from=build /src/app.jar /app/app.jar
EXPOSE 9999
ENV SPRING_PROFILES_ACTIVE=local \
    AIERP_MYSQL_HOST=aierp-mysql \
    AIERP_MYSQL_PORT=3306 \
    AIERP_REDIS_HOST=aierp-redis \
    AIERP_REDIS_PORT=6379 \
    AIERP_TOMCAT_BASEDIR=/opt/tmp/tomcat \
    AIERP_UPLOAD_PATH=/opt/jshERP/upload \
    AIERP_EXPORT_PATH=/opt/jshERP/export
ENTRYPOINT ["java", "-jar", "/app/app.jar", "--spring.profiles.active=local"]