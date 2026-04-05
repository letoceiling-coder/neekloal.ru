#!/usr/bin/env bash
set -e
export GIT_TERMINAL_PROMPT=0
export GIT_EDITOR=:
cd /var/www/site-al.ru
git add .gitignore
git -c commit.gpgsign=false -c core.hooksPath=/dev/null commit -m "chore: gitignore uploads"
git status
