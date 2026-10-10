#!/usr/bin/env bash
# Run summary for package-cleanup.yml. Two subcommands:
#
#   ghcr-report.sh snapshot <out.json>
#       Saves every version of the packages in $PACKAGES (id, digest, dates,
#       tags) to a file. Needs GH_TOKEN with read:packages.
#
#   ghcr-report.sh report <before.json> <after.json>
#       Writes a Markdown report to $GITHUB_STEP_SUMMARY (or stdout). In a live
#       run "deleted" is exactly what disappeared between the two snapshots. In
#       a dry run the "would delete" list is this script's own reading of the
#       same rules snok applies, so compare its count with snok's
#       "dry-run: Would have deleted" lines in the step log. They should match.
#       Needs docker logged in to ghcr.io, to read which per-arch images each
#       tagged version points at.
#
# Keep the rule numbers below in step with package-cleanup.yml.
set -euo pipefail

ORG="${ORG:-wickermoney}"
PACKAGES="${PACKAGES:-wicker-money wicker-money-preview}"
EDGE_KEEP="${EDGE_KEEP:-10}"            # newest edge-<sha> versions always kept
EDGE_DAYS="${EDGE_DAYS:-14}"
PRERELEASE_DAYS="${PRERELEASE_DAYS:-60}"
UNTAGGED_DAYS="${UNTAGGED_DAYS:-7}"
LIVE="${LIVE:-false}"

snapshot() {
  local out='{}' p raw arr
  for p in $PACKAGES; do
    if raw="$(gh api --paginate "/orgs/$ORG/packages/container/$p/versions?per_page=100" 2>/dev/null)"; then
      arr="$(jq -s 'add // [] | map({id, name, created_at, updated_at, tags: (.metadata.container.tags // [])})' <<<"$raw")"
    else
      arr='[]'
    fi
    out="$(jq --arg p "$p" --argjson a "$arr" '. + {($p): $a}' <<<"$out")"
  done
  printf '%s\n' "$out" > "$1"
}

# Digests of the per-arch images (and attestations) that a tagged version's
# manifest list points at, as {"sha256:...": "<tag of the parent>"}.
children_of() { # <package> <after.json>
  local p="$1" map='{}' name tag kids
  while IFS=$'\t' read -r name tag; do
    kids="$(docker buildx imagetools inspect --raw "ghcr.io/$ORG/$p@$name" 2>/dev/null \
      | jq -c --arg t "$tag" '[.manifests[]?.digest] | map({(.): $t}) | add // {}' 2>/dev/null || echo '{}')"
    [ -n "$kids" ] || kids='{}'
    map="$(jq -c --argjson k "$kids" '. + $k' <<<"$map")"
  done < <(jq -r --arg p "$p" '.[$p][] | select((.tags | length) > 0) | "\(.name)\t\(.tags[0])"' "$2")
  printf '%s' "$map"
}

report() { # <before.json> <after.json>
  local before="$1" after="$2" p kids mode
  if [ "$LIVE" = "true" ]; then mode="LIVE run"; else mode="DRY RUN (nothing was deleted)"; fi
  echo "# GHCR cleanup: $mode"
  echo
  echo "Rules: moving tags (latest, edge) and stable versions are never deleted. \`edge-<sha>\` older than ${EDGE_DAYS}d beyond the newest ${EDGE_KEEP}, prereleases older than ${PRERELEASE_DAYS}d, and untagged versions older than ${UNTAGGED_DAYS}d that no kept manifest list points at are deleted."
  echo

  for p in $PACKAGES; do
    kids="$(children_of "$p" "$after")"
    jq -r --arg p "$p" --argjson kids "$kids" --slurpfile b "$before" \
      --argjson edgeKeep "$EDGE_KEEP" --argjson edgeDays "$EDGE_DAYS" \
      --argjson preDays "$PRERELEASE_DAYS" --argjson unDays "$UNTAGGED_DAYS" \
      --arg live "$LIVE" '
      def age: ((now - (.updated_at | fromdateiso8601)) / 86400 | floor);
      def short: .name[7:19];
      def tagstr: if (.tags | length) > 0 then (.tags | join(", ")) else "(untagged)" end;
      def has($re): any(.tags[]?; test($re));

      .[$p] as $now
      | ($b[0][$p] // []) as $was
      # rank edge-<sha> versions, newest first
      | ([$now[] | select(has("^edge-"))] | sort_by(.updated_at) | reverse
         | to_entries | map({key: .value.name, value: .key}) | from_entries) as $edgeRank
      | ($now | map(
          . + (
            if (.tags | length) > 0 then
              if has("^(latest|edge)$") then {act: "keep", why: "moving tag"}
              elif has("^[0-9]+\\.[0-9]+\\.[0-9]+$") then {act: "keep", why: "stable release"}
              elif has("^[0-9]+\\.[0-9]+\\.[0-9]+-") then
                (if age > $preDays then {act: "delete", why: "prerelease older than \($preDays)d"}
                 else {act: "keep", why: "prerelease"} end)
              elif has("^edge-") then
                (if ($edgeRank[.name] >= $edgeKeep) and age > $edgeDays
                 then {act: "delete", why: "edge-<sha> beyond newest \($edgeKeep) and older than \($edgeDays)d"}
                 else {act: "keep", why: "recent edge-<sha>"} end)
              else {act: "keep", why: "other tag (preview-cleanup.yml owns these)"} end
            elif $kids[.name] then {act: "keep", why: "per-arch image of \($kids[.name])"}
            elif age <= $unDays then {act: "keep", why: "untagged but newer than \($unDays)d"}
            else {act: "delete", why: "untagged and unreferenced"} end)
        )) as $rows
      | ($rows | map(select(.act == "delete"))) as $del
      | ($now | map(.name)) as $nowNames
      | ($was | map(select(.name as $n | ($nowNames | any(. == $n)) | not))) as $gone
      | "## `\($p)`\n",
        "| | versions |\n|---|---:|",
        "| before this run | \($was | length) |",
        "| now | \($now | length) |",
        "| tagged | \($now | map(select((.tags | length) > 0)) | length) |",
        "| untagged, protected as per-arch images | \($rows | map(select(.why | startswith("per-arch"))) | length) |",
        (if $live == "true"
         then "| **deleted by this run** | **\($gone | length)** |"
         else "| **would delete** | **\($del | length)** |" end),
        "",
        (if $live == "true" then
           (if ($gone | length) == 0 then "Nothing was deleted." else
             "**Deleted**\n\n| id | digest | tags | age |\n|---|---|---|---:|",
             ($gone[] | "| \(.id) | `\(short)` | \(tagstr) | \(age)d |") end),
           (if ($del | length) > 0 then
             "\n**Still eligible after the run** (a delete failed, or the report and snok disagree):\n\n| id | digest | tags | why |\n|---|---|---|---|",
             ($del[] | "| \(.id) | `\(short)` | \(tagstr) | \(.why) |") else empty end)
         else
           (if ($del | length) == 0 then "Nothing would be deleted." else
             "**Would delete**\n\n| id | digest | tags | age | why |\n|---|---|---|---:|---|",
             ($del[] | "| \(.id) | `\(short)` | \(tagstr) | \(age)d | \(.why) |") end)
         end),
        "",
        "<details><summary>Everything kept (\($rows | map(select(.act == "keep")) | length))</summary>\n\n| id | digest | tags | age | why |\n|---|---|---|---:|---|",
        ($rows | map(select(.act == "keep")) | sort_by(.updated_at) | reverse | .[]
          | "| \(.id) | `\(short)` | \(tagstr) | \(age)d | \(.why) |"),
        "\n</details>\n"
      ' "$after"
  done
}

case "${1:-}" in
  snapshot) snapshot "${2:?out.json}" ;;
  report)   report "${2:?before.json}" "${3:?after.json}" ;;
  *) echo "usage: $0 snapshot <out.json> | report <before.json> <after.json>" >&2; exit 2 ;;
esac
