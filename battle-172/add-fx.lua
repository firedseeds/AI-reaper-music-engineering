-- add-fx.lua — 给战斗曲工程挂乐器
--
-- 用法：
--   1. 打开 battle-172-amin.rpp
--   2. Actions (按 ?) → 左下 Load ReaScript... → 选这个文件
--   3. 选中 add-fx.lua → Run
--
-- 按轨道名匹配：含 "Ample LP" 挂 Ample Guitar LP，含 "Surge XT" 挂 Surge XT，
-- 含 "MT-PowerDrumKit" 挂鼓。重复运行是安全的。

local rules = {
  { match = "MT-PowerDrumKit", fx = "MT-PowerDrumKit" },
  { match = "Surge XT",        fx = "Surge XT" },
}

local added, skipped, failed = 0, 0, 0
local problems = {}

for i = 0, reaper.CountTracks(0) - 1 do
  local tr = reaper.GetTrack(0, i)
  local _, name = reaper.GetTrackName(tr)
  for _, rule in ipairs(rules) do
    if name:find(rule.match, 1, true) then
      if reaper.TrackFX_GetByName(tr, rule.fx, false) >= 0 then
        skipped = skipped + 1
      else
        local idx = reaper.TrackFX_AddByName(tr, rule.fx, false, -1)
        if idx >= 0 then
          if idx > 0 then reaper.TrackFX_CopyToTrack(tr, idx, tr, 0, true) end
          added = added + 1
        else
          failed = failed + 1
          problems[#problems + 1] = name
        end
      end
    end
  end
end

reaper.Main_SaveProject(0, false)

local msg = string.format("已添加 %d 个，已存在 %d 个，失败 %d 个", added, skipped, failed)
if failed > 0 then
  msg = msg .. "\n\n找不到插件的轨道：\n" .. table.concat(problems, "\n")
end
reaper.MB(msg, "dsh-plugin", 0)

