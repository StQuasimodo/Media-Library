local mp = require 'mp'
local out = '/data/local/tmp/mpv-poc/mpv-probe.txt'
local function record(s)
  local f = assert(io.open(out, 'a')); f:write(s .. '\n'); f:close()
end
local function check(ok, msg) record((ok and 'PASS ' or 'FAIL ') .. msg) end
mp.register_event('file-loaded', function()
  mp.add_timeout(3, function()
    local tracks = mp.get_property_native('track-list') or {}
    local subs = {}
    for _, track in ipairs(tracks) do if track.type == 'sub' then table.insert(subs, track.id) end end
    check(#subs >= 2, 'two subtitle streams found')
    if #subs < 2 then return end
    mp.set_property_number('sid', subs[1]); mp.set_property_number('secondary-sid', subs[2])
    mp.set_property_number('sub-pos', 90); mp.set_property_number('secondary-sub-pos', 10)
    mp.set_property_number('sub-scale', 1.1); mp.set_property_number('secondary-sub-scale', 1.2)
    mp.add_timeout(3, function()
      check(mp.get_property_number('sid') == subs[1] and mp.get_property_number('secondary-sid') == subs[2], 'independent subtitle selection')
      check(mp.get_property_number('sub-pos') == 90 and mp.get_property_number('secondary-sub-pos') == 10, 'independent subtitle positions')
      record('INFO primary text=' .. tostring(mp.get_property('sub-text')) .. ' secondary text=' .. tostring(mp.get_property('secondary-sub-text')))
      record('INFO scales primary=' .. tostring(mp.get_property('sub-scale')) .. ' secondary=' .. tostring(mp.get_property('secondary-sub-scale')))
      check(math.abs((mp.get_property_number('sub-scale') or 0)-1.1)<0.01 and math.abs((mp.get_property_number('secondary-sub-scale') or 0)-1.2)<0.01, 'independent subtitle scales')
      mp.commandv('screenshot-to-file', '/data/local/tmp/mpv-poc/frame.png', 'subtitles')
      mp.set_property('pause','yes'); local before = mp.get_property_number('time-pos') or -1
      mp.add_timeout(2, function()
        local paused = mp.get_property_number('time-pos') or -2
        check(math.abs(paused-before)<0.3, 'pause holds playback')
        mp.commandv('seek', '25', 'absolute+exact')
        mp.add_timeout(3, function()
          local pos = mp.get_property_number('time-pos') or -1
          check(math.abs(pos-25)<1.5, 'seek to 25 seconds')
          mp.set_property('pause','no')
          mp.add_timeout(3, function()
            check((mp.get_property_number('time-pos') or -1)>pos+0.5, 'resume advances playback')
            record('DONE')
          end)
        end)
      end)
    end)
  end)
end)
