#!/usr/bin/env bash
# Persistent swap for the 2 GiB production k3s node (issue #72).
#
# During Argo reconciliation and Recreate rollouts the node ran out of memory and the
# Kubernetes API timed out. A temporary, non-persistent 2 GiB /swapfile recovered the
# cluster; this script makes that safety net permanent and reproducible. Swap is an
# emergency buffer for the k3s server process, not extra working memory, so
# vm.swappiness is kept low.
#
# Run as root on the host (it is not part of the container image). Idempotent: safe to
# re-run, and it adopts the existing /swapfile if the temporary one is still active.
#
#   sudo bash setup-swap.sh
#   DRY_RUN=1 bash setup-swap.sh        # print the plan without changing anything
#
# Overrides: SWAPFILE, SWAP_SIZE_MIB, SWAPPINESS, FSTAB, SYSCTL_DROPIN.
set -euo pipefail

SWAPFILE="${SWAPFILE:-/swapfile}"
SWAP_SIZE_MIB="${SWAP_SIZE_MIB:-2048}"
SWAPPINESS="${SWAPPINESS:-10}"
FSTAB="${FSTAB:-/etc/fstab}"
SYSCTL_DROPIN="${SYSCTL_DROPIN:-/etc/sysctl.d/99-workout-logger-swap.conf}"
DRY_RUN="${DRY_RUN:-0}"

run() {
  if [ "$DRY_RUN" = "1" ]; then
    echo "+ $*"
  else
    "$@"
  fi
}

if [ "$DRY_RUN" != "1" ] && [ "$(id -u)" -ne 0 ]; then
  echo "setup-swap.sh must run as root (or with DRY_RUN=1)." >&2
  exit 1
fi

swap_is_active() {
  [ -r /proc/swaps ] && awk -v f="$SWAPFILE" 'NR > 1 && $1 == f { found = 1 } END { exit !found }' /proc/swaps
}

if swap_is_active; then
  echo "Swap already active on $SWAPFILE; keeping it."
else
  if [ ! -e "$SWAPFILE" ]; then
    # Never fill the root filesystem: require the swap size plus 1 GiB of headroom.
    target_dir="$(dirname "$SWAPFILE")"
    available_mib="$(df -Pm "$target_dir" | awk 'NR == 2 { print $4 }')"
    if [ "$available_mib" -lt $((SWAP_SIZE_MIB + 1024)) ]; then
      echo "Only ${available_mib} MiB free in $target_dir; need $((SWAP_SIZE_MIB + 1024)) MiB." >&2
      exit 1
    fi
    echo "Creating ${SWAP_SIZE_MIB} MiB swapfile at $SWAPFILE."
    if [ "$DRY_RUN" = "1" ]; then
      echo "+ fallocate -l ${SWAP_SIZE_MIB}M $SWAPFILE (falls back to dd)"
    else
      fallocate -l "${SWAP_SIZE_MIB}M" "$SWAPFILE" 2>/dev/null \
        || dd if=/dev/zero of="$SWAPFILE" bs=1M count="$SWAP_SIZE_MIB" status=none
    fi
    run chmod 600 "$SWAPFILE"
    run mkswap "$SWAPFILE"
  else
    # Never run mkswap over an existing file: it would destroy whatever is in it.
    if [ ! -f "$SWAPFILE" ] || [ "$(blkid -p -s TYPE -o value "$SWAPFILE" 2>/dev/null || true)" != "swap" ]; then
      echo "$SWAPFILE exists but is not a swap file; refusing to overwrite it." >&2
      exit 1
    fi
    echo "$SWAPFILE is an existing, inactive swap file; re-enabling it."
    run chmod 600 "$SWAPFILE"
  fi
  run swapon "$SWAPFILE"
fi

fstab_entry="$SWAPFILE none swap sw 0 0"
if grep -qE "^[[:space:]]*${SWAPFILE//\//\\/}[[:space:]]+none[[:space:]]+swap[[:space:]]" "$FSTAB" 2>/dev/null; then
  echo "Swap entry for $SWAPFILE already present in $FSTAB."
else
  echo "Persisting swap in $FSTAB:"
  echo "+ append '$fstab_entry' to $FSTAB"
  if [ "$DRY_RUN" != "1" ]; then
    printf '%s\n' "$fstab_entry" >> "$FSTAB"
  fi
fi

echo "Setting vm.swappiness=$SWAPPINESS (persisted in $SYSCTL_DROPIN)."
if [ "$DRY_RUN" = "1" ]; then
  echo "+ write 'vm.swappiness=$SWAPPINESS' to $SYSCTL_DROPIN"
  echo "+ sysctl -w vm.swappiness=$SWAPPINESS"
else
  printf '# Managed by deploy/k3s/setup-swap.sh (issue #72)\nvm.swappiness=%s\n' "$SWAPPINESS" > "$SYSCTL_DROPIN"
  sysctl -w "vm.swappiness=$SWAPPINESS" > /dev/null
fi

if [ "$DRY_RUN" != "1" ]; then
  echo
  swapon --show
  free -m
fi
