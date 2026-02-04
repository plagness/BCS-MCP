import json
import sys
from pathlib import Path
import importlib.util

MANIFEST_PATH = Path(__file__).with_name("manifest.json")


def load_manifest():
    with MANIFEST_PATH.open("r", encoding="utf-8") as f:
        return json.load(f)


def load_script(path: Path):
    spec = importlib.util.spec_from_file_location("script_module", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "script name required"}), flush=True)
        sys.exit(1)

    script_name = sys.argv[1]
    payload_raw = sys.stdin.read().strip() or "{}"
    try:
        payload = json.loads(payload_raw)
    except Exception as exc:
        print(json.dumps({"error": "invalid json", "details": str(exc)}), flush=True)
        sys.exit(1)

    manifest = load_manifest()
    scripts = {s["name"]: s for s in manifest.get("scripts", [])}
    if script_name not in scripts:
        print(json.dumps({"error": "unknown script", "name": script_name}), flush=True)
        sys.exit(1)

    script_path = Path(__file__).parent.parent / scripts[script_name]["path"]
    if not script_path.exists():
        print(json.dumps({"error": "script file not found", "path": str(script_path)}), flush=True)
        sys.exit(1)

    module = load_script(script_path)
    if not hasattr(module, "run"):
        print(json.dumps({"error": "script missing run(payload)"}), flush=True)
        sys.exit(1)

    try:
        result = module.run(payload)
        print(json.dumps({"ok": True, "result": result}, ensure_ascii=False), flush=True)
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}), flush=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
