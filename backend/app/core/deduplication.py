from app.schemas import JobMeta
from app.store import find_job


def already_seen(job: JobMeta) -> bool:
    return find_job(job.platform, job.external_job_id, job.url) is not None
