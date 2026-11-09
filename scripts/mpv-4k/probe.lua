local mp = require 'mp'
local path='/data/local/tmp/mpv-4k/result.txt'
local function write(s) local f=assert(io.open(path,'a')); f:write(s..'\n'); f:close() end
local function check(v,s) write((v and 'PASS ' or 'FAIL ')..s) end
mp.register_event('file-loaded', function()
  mp.add_timeout(5, function()
    local w=mp.get_property_number('video-params/w') or 0
    local h=mp.get_property_number('video-params/h') or 0
    local codec=mp.get_property('video-codec') or ''
    local fmt=mp.get_property('video-params/pixelformat') or ''
    local dec=mp.get_property('hwdec-current') or 'unknown'
    local fallback=mp.get_property('hwdec-software-fallback') or 'unknown'
    local t=mp.get_property_number('time-pos') or -1
    write('INFO codec='..codec..' size='..w..'x'..h..' pixelformat='..fmt..' hwdec='..dec..' fallback='..fallback..' time='..t)
    check(w==3840 and h==2160 and codec:lower():find('hevc',1,true)~=nil,'4K HEVC stream parsed')
    check(t>0,'playback clock advanced')
    check(fallback=='1' or fallback=='yes','software fallback requested')
    mp.commandv('screenshot-to-file','/data/local/tmp/mpv-4k/frame.png','video')
    write('DONE')
  end)
end)
