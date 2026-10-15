export interface BuildMetadata {
  version?: string | null;
  commit?: string | null;
}

export interface BuildLabel {
  /** Short text for the header badge. */
  text: string;
  /** Full sentence for assistive technology and the tooltip. */
  description: string;
  kind: "release" | "dev" | "unknown";
}

const RELEASE = /^v?\d+\.\d+\.\d+(-(alpha|beta|rc)(\.\d+)?)?$/;
const PLACEHOLDERS = new Set(["", "dev", "unknown"]);

function shortCommit(commit: string | null | undefined): string | null {
  return commit && /^[0-9a-f]{7,40}$/i.test(commit) ? commit.slice(0, 7) : null;
}

/** Describes the build the server reports in /health, without guessing. */
export function describeBuild(metadata: BuildMetadata | null): BuildLabel {
  const version = (metadata?.version ?? "").trim();
  const commit = shortCommit(metadata?.commit);

  if (RELEASE.test(version)) {
    const tag = version.startsWith("v") ? version : `v${version}`;
    return {
      text: commit ? `${tag} · ${commit}` : tag,
      description: `Release ${tag}, commit ${commit ?? "unknown"}`,
      kind: "release",
    };
  }
  if (PLACEHOLDERS.has(version.toLowerCase()) && !commit) {
    return {
      text: "version unknown",
      description: "The server did not report its version",
      kind: "unknown",
    };
  }
  const name = PLACEHOLDERS.has(version.toLowerCase()) ? commit : version;
  return {
    text: `dev build (${name})`,
    description: `Development build ${name}, commit ${commit ?? "unknown"}`,
    kind: "dev",
  };
}
