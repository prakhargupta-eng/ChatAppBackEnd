import json

filepath = 'ChatApp.postman_collection.json'
with open(filepath, 'r') as f:
    collection = json.load(f)

# Add Health Check
health_item = {
  "name": "Health Check",
  "request": {
    "method": "GET",
    "header": [],
    "url": {
      "raw": "http://localhost:3000/health",
      "protocol": "http",
      "host": ["localhost"],
      "port": "3000",
      "path": ["health"]
    }
  }
}

# check if it already exists
found = False
for item in collection['item']:
    if item['name'] == 'Health Check':
        found = True
        break

if not found:
    collection['item'].insert(0, health_item)

with open(filepath, 'w') as f:
    json.dump(collection, f, indent=2)

print("Added Health Check.")
