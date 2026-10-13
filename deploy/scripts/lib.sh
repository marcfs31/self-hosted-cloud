# shellcheck shell=bash
# Shared helpers for the host scripts. Sourced, never executed.
#
# write_report: publish a status report for the admin dashboard (apps/api reads it through
# packages/shared hostReport). The shape is exactly
#   {"ok":true|false,"checkedAt":"2026-10-13T12:00:00Z","facts":{"key":"value",...}}
# and the write is atomic (temp file in the same directory + mv), so the API never reads a
# half-written file. Plain bash only: no jq, no python.

# json_escape <string>  ->  the string as the inside of a JSON string literal, on stdout.
json_escape() {
  local s="$1"
  s=${s//\\/\\\\}
  s=${s//\"/\\\"}
  s=${s//$'\n'/\\n}
  s=${s//$'\r'/\\r}
  s=${s//$'\t'/\\t}
  # Any other control character is not valid inside a JSON string: replace it with a space.
  s=${s//[[:cntrl:]]/ }
  printf '%s' "$s"
}

# write_report <file> <true|false> [key=value ...]
#   Facts are short machine-readable strings. Keys are [A-Za-z0-9_-]+. The directory must
#   already exist (it is created by pi-setup.md on the data disk; creating it here could
#   silently fill the root filesystem when /data is not mounted). The file is world-readable
#   (0644) because the API container runs as uid 1000 and the host scripts as root.
#   Returns non-zero, with a message on stderr, when the report could not be published.
write_report() {
  local file="$1" ok="$2"
  shift 2
  case "${ok}" in true | false) ;; *)
    printf 'write_report: ok must be true or false, got: %s\n' "${ok}" >&2
    return 1
    ;;
  esac
  local dir base tmp checked facts="" sep="" kv key val
  dir="$(dirname -- "${file}")"
  base="$(basename -- "${file}")"
  for kv in "$@"; do
    key="${kv%%=*}"
    val="${kv#*=}"
    case "${key}" in
      "" | *[!A-Za-z0-9_-]*)
        printf 'write_report: invalid fact key: %s\n' "${key}" >&2
        return 1
        ;;
    esac
    facts="${facts}${sep}\"${key}\":\"$(json_escape "${val}")\""
    sep=","
  done
  checked="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  tmp="$(mktemp "${dir}/.${base}.XXXXXX")" || {
    printf 'write_report: cannot create a temp file in %s\n' "${dir}" >&2
    return 1
  }
  if printf '{"ok":%s,"checkedAt":"%s","facts":{%s}}\n' "${ok}" "${checked}" "${facts}" >"${tmp}" &&
    chmod 0644 "${tmp}" &&
    mv -f -- "${tmp}" "${file}"; then
    return 0
  fi
  rm -f -- "${tmp}"
  printf 'write_report: cannot write %s\n' "${file}" >&2
  return 1
}
