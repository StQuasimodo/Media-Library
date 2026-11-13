package io.mycinema.tv;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import okhttp3.HttpUrl;
import org.json.JSONArray;
import org.json.JSONObject;

/** Metadata-only capability inspection. Signed URLs are validated then discarded. */
final class QuarkCloudVersions {
    static final class Version {
        final String quality,protocol,codec,audioCodec,state;
        final int width,height,channels;final long bitrate;final double fps;
        Version(String quality,String protocol,String codec,String audioCodec,String state,int width,int height,int channels,long bitrate,double fps){
            this.quality=quality;this.protocol=protocol;this.codec=codec;this.audioCodec=audioCodec;this.state=state;
            this.width=width;this.height=height;this.channels=channels;this.bitrate=bitrate;this.fps=fps;
        }
        boolean canTrial(){return protocol.equals("HLS")&&state.equals("服务端提供地址")&&!quality.equals("未标注");}
        String selector(){return quality+"|"+width+"|"+height+"|"+codec+"|"+audioCodec+"|"+channels+"|HLS";}
        String label(){return qualityLabel()+" · "+(width>0&&height>0?width+"×"+height:"尺寸未标注")+" · "+state;}
        private String qualityLabel(){switch(quality){case "low":return "低清档";case "normal":return "标清档";case "high":return "高清档";case "super":return "超清档";case "2k":return "2K档";case "4k":return "4K档";default:return "未标注档位";}}
        String details(){return "服务端标称资料（尚未实际解码）\n\n"+label()+"\n协议："+protocol+"\n视频编码："+codec+
            "\n帧率："+(fps>0?String.format(Locale.ROOT,"%.2f fps",fps):"未标注")+
            "\n视频码率："+(bitrate>0?String.format(Locale.ROOT,"%.2f Mbps",bitrate/1000000.0):"未标注")+
            "\n音频编码："+audioCodec+"\n声道："+(channels>0?String.valueOf(channels):"未标注")+
            "\n\n仅支持手动试播完整点播HLS，其他协议尚未开放。云端版本可能降低清晰度，音轨、字幕及HDR也可能与原文件不同。试播进度在本机单独保存，暂不纳入备份，不更改原文件进度。";}
    }
    static HttpUrl selectHls(JSONObject response,String selector){
        if(selector==null||selector.length()>256)throw new IllegalArgumentException("云端版本标识无效。");
        JSONArray rows=Json.array(response.optJSONObject("data"),"video_list");if(rows.length()>200)throw new IllegalStateException("云端版本数量异常。");HttpUrl selected=null;
        for(int i=0;i<rows.length();i++){
            JSONObject row=rows.optJSONObject(i);if(row==null)continue;JSONObject data=new JSONObject(),one=new JSONObject();Json.put(data,"video_list",new JSONArray().put(row));Json.put(one,"data",data);
            List<Version> versions=parse(one);if(versions.isEmpty()||!versions.get(0).canTrial()||!versions.get(0).selector().equals(selector))continue;
            HttpUrl url=HttpUrl.parse(Json.text(row.optJSONObject("video_info"),"url"));
            if(url==null||url.toString().length()>8192||url.port()!=443||!url.host().contains(".")||url.host().matches("[0-9.]+")||url.host().contains(":")||url.host().endsWith(".local"))throw new IllegalStateException("云端地址不适合安全试播。");
            if(selected!=null&&!selected.equals(url))throw new IllegalStateException("云端版本存在歧义，请重新检查。");selected=url;
        }
        if(selected==null)throw new IllegalStateException("所选HLS版本未就绪或已变化，请重新检查。");return selected;
    }
    private static double number(JSONObject object,String key,double max){Object raw=object.opt(key);if(!(raw instanceof Number))return 0;double value=((Number)raw).doubleValue();return !Double.isNaN(value)&&!Double.isInfinite(value)&&value>0&&value<=max?value:0;}
    private static int integer(JSONObject object,String key,int max){double value=number(object,key,max);return value==Math.floor(value)?(int)value:0;}
    private static String token(JSONObject object,String key,String choices){String value=Json.text(object,key).toLowerCase(Locale.ROOT);return (","+choices+",").contains(","+value+",")&&!value.isEmpty()?value:"未标注";}
    static List<Version> parse(JSONObject response){
        JSONObject data=response.optJSONObject("data");JSONArray rows=data==null?null:data.optJSONArray("video_list");
        if(rows==null||rows.length()>200)throw new IllegalStateException("夸克未返回可识别的云端版本资料。");
        List<Version> versions=new ArrayList<>();Set<String> seen=new HashSet<>();
        for(int i=0;i<rows.length();i++){
            JSONObject row=rows.optJSONObject(i),info=row==null?null:row.optJSONObject("video_info");if(row==null)continue;boolean incomplete=info==null;if(incomplete)info=new JSONObject();
            String format=token(info,"format","mp4,fmp4,fmp4_av,hls,m3u8,ts,mpegts,mkv,webm"),rawUrl=Json.text(info,"url");
            HttpUrl url=HttpUrl.parse(rawUrl);boolean address=url!=null&&url.isHttps()&&url.username().isEmpty()&&url.password().isEmpty()&&url.fragment()==null;
            String protocol=(address&&url.encodedPath().toLowerCase(Locale.ROOT).endsWith(".m3u8"))||format.equals("m3u8")||format.equals("hls")?"HLS":format.equals("fmp4")||format.equals("fmp4_av")?"fMP4":format.equals("mp4")?"MP4":"未知";
            String state=incomplete?"资料尚不完整":"状态未知";
            if(Boolean.FALSE.equals(row.opt("accessable")))state="当前账号不可用";
            else if(Boolean.FALSE.equals(info.opt("success"))||Boolean.FALSE.equals(info.opt("finish")))state="尚未就绪";
            else if(address)state="服务端提供地址";
            else if(!rawUrl.isEmpty())state="地址格式不支持";
            String quality=token(row,"resolution","low,normal,high,super,2k,4k");
            JSONObject audio=info.optJSONObject("audio");if(audio==null)audio=new JSONObject();
            Version version=new Version(quality,protocol,token(info,"codec","h264,avc,avc1,h265,hevc,hvc1,hev1,av1,av01,vp8,vp9,vp09,mpeg2,mpeg4"),
                token(audio,"codec","aac,ac3,eac3,ac-3,ec-3,dts,flac,mp3,opus,vorbis,pcm,mp2"),state,
                integer(info,"width",16384),integer(info,"height",16384),integer(audio,"channels",32),(long)number(info,"bitrate",1000000000),number(info,"fps",240));
            String key=version.details();if(seen.add(key)){versions.add(version);if(versions.size()>32)throw new IllegalStateException("云端版本数量异常，请稍后重试。");}
        }
        Collections.sort(versions,(a,b)->{int order=Integer.compare(b.height,a.height);if(order==0)order=Integer.compare(b.width,a.width);if(order==0)order=a.quality.compareTo(b.quality);return order==0?a.protocol.compareTo(b.protocol):order;});
        return Collections.unmodifiableList(versions);
    }
}
