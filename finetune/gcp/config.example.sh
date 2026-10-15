# shellcheck shell=bash disable=SC2034
# Copy to config.local.sh (not committed) and fill in. Sourced by config.sh.
ALLOWED_ACCOUNT="you@example.com"
ALLOWED_PROJECT="your-gcp-project-id"
ALLOWED_BILLING="billingAccounts/XXXXXX-XXXXXX-XXXXXX"
LOCAL_BUCKET="gs://your-bucket-name"
# Optional: service account name of the training VM.
# LOCAL_VM_SA_NAME="browsby-trainer-vm"
