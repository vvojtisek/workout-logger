# Small-host protections for the production k3s node

Tracks issue #72. The production node has 2 GiB RAM. During Argo CD reconciliation and
`Recreate` rollouts k3s reached ~1.7 GiB used with <200 MB available, load above 18, and
Kubernetes API `TLS handshake timeout` / `Handler timeout` errors. A temporary, non-persistent
2 GiB `/swapfile` restored the cluster.

The protections are layered, cheapest first. Only the host steps (1 and 2) need to be run
by hand; they cannot live in the Helm chart. Git stays the source of truth for everything
Argo CD manages.

| Layer | Where | What it does |
|---|---|---|
| Bounded Job resources | `helm/workout-logger/values-prod.yaml` | Migration, backup and restore Jobs cannot stack unbounded memory on a rollout (already merged in #84). |
| Argo sync behaviour | `deploy/argocd/application.yaml` | `ApplyOutOfSyncOnly=true` cuts API calls per sync; `retry` with backoff recovers from failed syncs without a manual k3s restart. Re-apply the Application after merging (step 3). |
| Persistent swap | `setup-swap.sh` | Makes the incident's temporary swapfile permanent, with low `vm.swappiness`, so the k3s server process has headroom. |
| Memory reservation | `config.yaml.d/10-small-host.yaml` | Reserves memory for the control plane and evicts pods before the node thrashes. |

## 1. Persistent swap (non-disruptive)

On the node, as root, from a checkout of this repository:

```bash
DRY_RUN=1 bash deploy/k3s/setup-swap.sh   # review the plan first
sudo bash deploy/k3s/setup-swap.sh
```

It reuses the existing `/swapfile` if the temporary one is still active, refuses to touch an
existing file that is not swap, requires the swap size plus 1 GiB of free disk, and adds the
`/etc/fstab` entry and a `vm.swappiness=10` sysctl drop-in only once. Re-running is safe.

## 2. Memory reservation for the control plane (restarts k3s)

```bash
sudo install -d /etc/rancher/k3s/config.yaml.d
sudo install -m 0644 deploy/k3s/config.yaml.d/10-small-host.yaml \
  /etc/rancher/k3s/config.yaml.d/10-small-host.yaml
sudo systemctl restart k3s
```

Do this in a quiet moment: the API is unavailable for a short time while k3s restarts, though
running pods and the public route keep serving. The drop-in uses `kubelet-arg+`, so it appends
to any `kubelet-arg` already in `/etc/rancher/k3s/config.yaml` rather than replacing it.

Verify (allocatable memory should now be about 0.5 GiB lower than capacity):

```bash
kubectl get node -o custom-columns=NAME:.metadata.name,CAP:.status.capacity.memory,ALLOC:.status.allocatable.memory
```

Rollback: delete the drop-in and `sudo systemctl restart k3s`.

## 3. Apply the Argo Application change

The Application is applied by hand (it does not manage itself), so merging the change is not
enough:

```bash
kubectl apply -f deploy/argocd/application.yaml
```

## Closing the issue

These values are a starting point sized from the 2026-08-23 incident, not measured on the
current node, and the swap and kubelet behaviour above has not been exercised on the live
cluster from this repository. Treat #72 as fixed only after a normal immutable-image promotion
completes with no API timeouts and no manual k3s restart. Check `free -m`, `swapon --show` and
`journalctl -u k3s | grep -i "timeout"` during the rollout.

## Not covered here

* Argo CD's own components are not defined in this repository (only the Application is), so
  their resource limits and `argocd-cmd-params-cm` parallelism settings cannot be versioned
  here. If rollouts still starve the API after the steps above, limiting the
  application-controller and repo-server is the next lever.
* Resizing the instance. If memory pressure persists with these protections in place, moving
  to a 4 GiB instance is the straightforward fix; that is a cost decision for the owner.
