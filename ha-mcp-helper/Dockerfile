ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base-python:3.11-alpine
FROM ${BUILD_FROM}

# Set environment
ENV LANG="C.UTF-8" \
    PYTHONUNBUFFERED=1 \
    CONFIG_ROOT="/config"

WORKDIR /app

# Install dependencies and system utilities (jq for options parsing)
RUN apk add --no-cache jq gcc musl-dev linux-headers python3-dev \
    && pip install --no-cache-dir \
        fastapi>=0.110.0 \
        uvicorn>=0.28.0 \
        pydantic>=2.6.0 \
        pyyaml>=6.0.1 \
        aiofiles>=23.2.1 \
        psutil>=5.9.0

# Copy application files
COPY app /app/app
COPY run.sh /run.sh
RUN chmod a+x /run.sh

# Expose REST API port
EXPOSE 8099

CMD [ "/run.sh" ]
