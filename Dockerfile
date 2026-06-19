FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git \
    && rm -rf /var/lib/apt/lists/*
# docker-rootfs/ is the extracted contents of mewrite-linux-x64.tar.gz (binary + companions).
# mewrite resolves theme/, export-html/, photon_rs_bg.wasm via dirname(process.execPath),
# so the binary and companions must live together.
COPY docker-rootfs/ /opt/mewrite/
RUN chmod +x /opt/mewrite/mewrite && ln -s /opt/mewrite/mewrite /usr/local/bin/mewrite
WORKDIR /work
ENTRYPOINT ["mewrite"]
