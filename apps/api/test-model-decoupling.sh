#!/bin/bash
cd /var/www/site-al.ru/apps/api
TOK=$(node tok.js 2>/dev/null | tail -1)
BASE="http://127.0.0.1:4000"
H="Authorization: Bearer $TOK"

echo ""
echo "=== TEST 1: GET /models returns [{name}] objects ==="
MODELS=$(curl -sf -H "$H" $BASE/models)
echo "$MODELS"
echo "$MODELS" | python3 -c "import sys,json; d=json.load(sys.stdin); assert isinstance(d['models'][0],dict) and 'name' in d['models'][0], 'FAIL'; print('  ✅ models is [{name}] format')"

echo ""
echo "=== TEST 2: POST /agents with model=qwen2.5:7b ==="
AGENT=$(curl -sf -X POST $BASE/agents \
  -H "$H" -H "Content-Type: application/json" \
  -d '{"name":"Model Test Agent","type":"test","model":"qwen2.5:7b","rules":"Answer briefly."}')
echo "$AGENT" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d.get('model')=='qwen2.5:7b','FAIL'; print('  ✅ agent.model='+d['model'])"
AGENT_ID=$(echo "$AGENT" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
echo "  agentId=$AGENT_ID"

echo ""
echo "=== TEST 3: GET /agents shows model column ==="
curl -sf -H "$H" $BASE/agents | python3 -c "
import sys,json
agents = json.load(sys.stdin)
agent = next((a for a in agents if a.get('model')=='qwen2.5:7b'), None)
assert agent, 'FAIL: agent with model not found'
print('  ✅ agent in list has model=' + agent['model'])
"

echo ""
echo "=== TEST 4: Create conversation + chat/v2 uses agent.model ==="
CONV=$(curl -sf -X POST $BASE/agents/conversations \
  -H "$H" -H "Content-Type: application/json" \
  -d "{\"agentId\":\"$AGENT_ID\"}")
CONV_ID=$(echo "$CONV" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
echo "  convId=$CONV_ID"

CHAT=$(curl -sf -X POST $BASE/agents/chat/v2 \
  -H "$H" -H "Content-Type: application/json" \
  -d "{\"conversationId\":\"$CONV_ID\",\"message\":\"What is 1+1?\"}")
echo "$CHAT" | python3 -c "
import sys,json
d=json.load(sys.stdin)
assert d.get('modelUsed')=='qwen2.5:7b', f'FAIL: expected qwen2.5:7b got {d.get(\"modelUsed\")}'
print('  ✅ modelUsed=' + d['modelUsed'] + ' (from agent.model, source=agent)')
print('  reply:', d.get('reply','')[:60])
"

echo ""
echo "=== TEST 5: User override — model=llama3:8b overrides agent.model ==="
CHAT2=$(curl -sf -X POST $BASE/agents/chat/v2 \
  -H "$H" -H "Content-Type: application/json" \
  -d "{\"conversationId\":\"$CONV_ID\",\"message\":\"Name a color.\",\"model\":\"llama3:8b\"}")
echo "$CHAT2" | python3 -c "
import sys,json
d=json.load(sys.stdin)
assert d.get('modelUsed')=='llama3:8b', f'FAIL: expected llama3:8b got {d.get(\"modelUsed\")}'
print('  ✅ modelUsed=' + d['modelUsed'] + ' (user override, source=user)')
"

echo ""
echo "=== PM2 [agent:model] log lines ==="
pm2 logs ai-api --lines 50 --nostream 2>/dev/null | grep '\[agent:model\]' | tail -5

echo ""
echo "=== ALL TESTS DONE ==="
