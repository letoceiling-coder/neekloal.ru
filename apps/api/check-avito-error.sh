#!/bin/bash
# Get FULL error from pm2 logs (no grep truncation)
pm2 logs ai-api --lines 200 --nostream 2>/dev/null | grep -A20 "async error eventId=avito_v2-test-001" | head -50
