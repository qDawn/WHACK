import json
from pathlib import Path

message = json.loads(Path("fixtures/suggestion.json").read_text(encoding="utf-8"))
suggestion = message["payload"]["suggestion"]
print(suggestion["title"])
print(suggestion["detail"])
print("source:", suggestion["source"])