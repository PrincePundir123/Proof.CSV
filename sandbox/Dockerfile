FROM python:3.12-slim
RUN pip install --no-cache-dir pandas==2.2.3 numpy==2.2.3 matplotlib==3.10.1
RUN groupadd --gid 10001 sandbox && useradd --uid 10001 --gid sandbox --no-create-home sandbox
COPY runner.py /opt/proofcsv/runner.py
ENV MPLBACKEND=Agg MPLCONFIGDIR=/tmp/matplotlib HOME=/tmp OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1
USER 10001:10001
WORKDIR /workspace
ENTRYPOINT ["python", "-I", "-u", "/opt/proofcsv/runner.py"]
