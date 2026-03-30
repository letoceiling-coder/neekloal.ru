#!/bin/bash
curl -s http://188.124.55.89:11434/api/tags | grep -o '"name":"[^"]*"' | sed 's/"name":"//;s/"//'
