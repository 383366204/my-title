#!/bin/bash
# 一键创建同行发现流水线的 PM 视角 issue
# 直接从 docs/peer-discovery-issues.md 提取每个 Issue 的正文，避免维护两套内容
# 用法: bash docs/create-peer-issues.sh
set -e

REPO="383366204/my-title"
DOC="docs/peer-discovery-issues.md"

if [ ! -f "$DOC" ]; then
  echo "错误: 找不到 $DOC"
  exit 1
fi

# 守护拦截：已在 docs/peer-discovery-issues.md 中统一收敛至 GitHub #58–#62
echo "================================================================="
echo "⚠️  提示: 任务基线已统一收敛至 GitHub #58–#62（详见 docs/peer-discovery-issues.md）。"
echo "本地 Issue A–K 仅作为模块研发验收参考，本脚本已停用，防止重复创建线上任务。"
echo "若后续确需强制测试创建，请手动注释本守护行 (exit 0)。"
echo "================================================================="
exit 0

# 从 md 文件中提取 Issue X 的标题和正文
# 标题: ### Issue X: [同行发现-SY] 标题文字
# 正文: 从标题下一行到下一个 --- 或 ### Issue 之前
extract_issue() {
  local letter="$1"
  # 用 awk 提取从 "### Issue X:" 到下一个 "---" 之间的内容
  awk -v letter="$letter" '
    BEGIN { found=0; title="" }
    /^### Issue / {
      if (found) { exit }
      if (index($0, "Issue " letter ":") > 0) {
        found=1
        # 提取标题: "### Issue A: [同行发现-S0] 技术探针..."  → "[同行发现-S0] 技术探针..."
        match($0, /\[.*\]/)
        if (RSTART > 0) title = substr($0, RSTART, RLENGTH)
        next
      }
    }
    found && /^---$/ { exit }
    found && /^## / { exit }
    found { print }
  ' "$DOC"
}

extract_title() {
  local letter="$1"
  grep "^### Issue ${letter}:" "$DOC" | sed 's/.*\] //' | sed 's/ *$//'
}

create_issue() {
  local letter="$1"
  local sprint="$2"
  local title
  title=$(extract_title "$letter")
  local body
  body=$(extract_issue "$letter")

  if [ -z "$title" ] || [ -z "$body" ]; then
    echo "⚠️  跳过 Issue $letter: 未在 $DOC 中找到内容"
    return 1
  fi

  echo "=== 创建 Issue $letter: $title ==="
  gh issue create --repo "$REPO" \
    --title "[同行发现-$sprint] $title" \
    --body "$body"
  echo ""
  sleep 2
}

echo "从 $DOC 提取 issue 内容并创建..."
echo ""

create_issue "A" "S0"
create_issue "B" "S1"
create_issue "C" "S1"
create_issue "D" "S1"
create_issue "E" "S1"
create_issue "F" "S2"
create_issue "G" "S2"
create_issue "H" "S2"
create_issue "I" "S2"
create_issue "J" "S3"
create_issue "K" "S3"

echo "=== 全部创建完成 ==="
echo "详见 $DOC"
