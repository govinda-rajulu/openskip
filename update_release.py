#!/usr/bin/env python3
"""CI helper: update updates.json and commit via GitHub API."""
import sys, json, urllib.request, base64

version, repo, token = sys.argv[1], sys.argv[2], sys.argv[3]

# Write updates.json
data = {
    "addons": {
        "skipstream@extension": {
            "updates": [{
                "version": version,
                "update_link": f"https://github.com/{repo}/releases/download/v{version}/skipstream-{version}-firefox.zip",
                "update_info_url": f"https://github.com/{repo}/releases/tag/v{version}"
            }]
        }
    }
}
with open("updates.json", "w") as f:
    json.dump(data, f, indent=2)
    f.write("\n")
print(f"updates.json -> {version}")

# Commit via GitHub API
req = urllib.request.Request(
    f"https://api.github.com/repos/{repo}/contents/updates.json",
    headers={"Authorization": f"token {token}", "Accept": "application/vnd.github+json"}
)
with urllib.request.urlopen(req) as r:
    sha = json.loads(r.read())["sha"]

payload = json.dumps({
    "message": f"chore: bump updates.json to v{version} [skip ci]",
    "content": base64.b64encode(open("updates.json", "rb").read()).decode(),
    "sha": sha
}).encode()
req2 = urllib.request.Request(
    f"https://api.github.com/repos/{repo}/contents/updates.json",
    data=payload,
    headers={"Authorization": f"token {token}", "Content-Type": "application/json",
             "Accept": "application/vnd.github+json"},
    method="PUT"
)
with urllib.request.urlopen(req2) as r2:
    d = json.loads(r2.read())
    print("committed:", d["commit"]["sha"][:12])
