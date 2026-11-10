package io.mycinema.tv;

import org.json.JSONObject;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Conservative filename facts; ambiguous titles are left for user association. */
final class ResourceName {
    private static final String NUMBER="(?:[0-9]{1,3}|零|[一二三四五六七八九两]?十[一二三四五六七八九]?|[一二三四五六七八九两])";
    private static String token(String pattern){return "(?<![a-z0-9])(?:"+pattern+")(?![a-z0-9])";}
    private static String find(String name,String pattern){Matcher matcher=Pattern.compile(pattern,Pattern.CASE_INSENSITIVE).matcher(name);return matcher.find()?matcher.group():"";}
    static JSONObject parse(String name){
        JSONObject info=new JSONObject();String clean=name.replaceAll("(?i)\\.(?:mkv|mp4|m4v|avi|mov|ts|m2ts|mts|wmv|webm|mpg|mpeg|flv)$","");
        Matcher season=Pattern.compile("(?i)(?:(?<![a-z0-9])S(\\d{1,2})(?:E\\d{1,3})*(?![a-z0-9])|(?<![a-z0-9])Season[ ._-]*(\\d{1,2})(?![a-z0-9])|第("+NUMBER+")季)").matcher(clean);
        boolean seasonKnown=season.find();int seasonNumber=0;if(seasonKnown){String number=season.group(1)!=null?season.group(1):season.group(2)!=null?season.group(2):season.group(3);seasonNumber=number(number);}
        Matcher episode=Pattern.compile("(?i)(?:(?<![a-z0-9])S\\d{1,2}E(\\d{1,3})(?=$|[^a-z0-9]|E\\d)|(?<![a-z0-9])E(?:P)?[ ._-]*(\\d{1,3})(?![a-z0-9])|第("+NUMBER+")集)").matcher(clean);
        boolean episodeKnown=episode.find();int episodeNumber=0;if(episodeKnown)episodeNumber=number(episode.group(1)!=null?episode.group(1):episode.group(2)!=null?episode.group(2):episode.group(3));
        String quality=find(clean,"(?<![a-z0-9])(?:4320p|2160p|1080[pi]|720p|480p|8k|4k|uhd)(?![a-z0-9])");
        String dimensions=find(clean,token("(?:7680|4096|3840|2560|2048|1920|1280|720)[x×](?:4320|2160|1440|1080|720|576|480)"));
        String codec=find(clean,token("HEVC|AVC|x26[45]|h[ ._-]?26[45]|AV1|MPEG[ ._-]?2"));
        String audio=find(clean,token("(?:TrueHD|DTS(?:[ ._-]?(?:HD(?:[ ._-]?(?:MA|HRA))?|X))?|DDP|DD\\+|DD|E[ ._-]?AC[ ._-]?3|AC[ ._-]?3|AAC|FLAC|Atmos)(?:[ ._-]?[257]\\.[01](?:\\.[24])?)?"));
        String source=find(clean,token("Blu[ ._-]?Ray|BDRemux|Remux|WEB[ ._-]?(?:DL|Rip)|HDTV|BDRip|DVDRip"));
        String hdr=find(clean,token("HDR10\\+?|HDR|Dolby[ ._-]?Vision|DV"));
        int cut=clean.length();for(String marker:new String[]{quality,dimensions,codec,audio,source,hdr})if(!marker.isEmpty()){int at=markerIndex(clean,marker);if(at>=0)cut=Math.min(cut,at);}
        if(seasonKnown)cut=Math.min(cut,season.start());if(episodeKnown)cut=Math.min(cut,episode.start());
        // Only years before the technical suffix can describe the work. A leading numeric
        // title remains a title; choose the last later year, as on the Windows client.
        String year="";int yearAt=-1;Matcher years=Pattern.compile(token("(?:19|20)\\d{2}"),Pattern.CASE_INSENSITIVE).matcher(clean.substring(0,cut));
        while(years.find())if(!title(clean.substring(0,years.start())).isEmpty()){year=years.group();yearAt=years.start();}
        if(yearAt>=0)cut=yearAt;
        String title=title(clean.substring(0,cut));if(quality.isEmpty())quality=dimensions;
        Json.put(info,"title",title);Json.put(info,"season",seasonNumber);Json.put(info,"seasonKnown",seasonKnown);Json.put(info,"episode",episodeNumber);Json.put(info,"episodeKnown",episodeKnown);Json.put(info,"quality",quality.toUpperCase(Locale.ROOT));Json.put(info,"codec",codec);Json.put(info,"audio",audio);Json.put(info,"source",source);Json.put(info,"hdr",hdr);Json.put(info,"year",year);return info;
    }
    private static String title(String value){return value.replaceAll("^[\\[【][^\\]】]*[\\]】]","").replaceAll("[._]"," ").replaceAll("^[\\[\\]【】()（） -]+|[\\[\\]【】()（） -]+$","").replaceAll("\\s+"," ").trim();}
    private static int markerIndex(String clean,String marker){Matcher match=Pattern.compile(token(Pattern.quote(marker)),Pattern.CASE_INSENSITIVE).matcher(clean);return match.find()?match.start():-1;}
    private static int number(String text){try{return Integer.parseInt(text);}catch(NumberFormatException ignored){String digits="零一二三四五六七八九";if(text.equals("两"))return 2;if(text.length()==1)return text.equals("十")?10:Math.max(0,digits.indexOf(text));int ten=text.indexOf('十');if(ten>=0){int tens=ten==0?1:digits.indexOf(text.charAt(0));int ones=ten+1==text.length()?0:digits.indexOf(text.charAt(ten+1));return Math.max(0,tens*10+ones);}return 0;}}
    static String normalized(String value){return value.toLowerCase(Locale.ROOT).replaceAll("[^\\p{L}\\p{N}]","");}
    static JSONObject hint(String name,String parentName){
        JSONObject info=parse(name),folder=parse(parentName);
        if(Json.text(info,"title").isEmpty())Json.put(info,"title",Json.text(folder,"title"));
        if(!info.optBoolean("seasonKnown")&&folder.optBoolean("seasonKnown")){Json.put(info,"season",folder.optInt("season"));Json.put(info,"seasonKnown",true);}
        return info;
    }
    static String match(String name,String parentName,List<Library.Item> items){
        JSONObject info=hint(name,parentName);String title=normalized(Json.text(info,"title"));
        boolean seasonKnown=info.optBoolean("seasonKnown");int season=info.optInt("season");String found="";
        if(title.length()<2)return "";
        for(Library.Item item:items){
            boolean tv=Json.text(item.film,"mediaType").equals("tv");String external=Json.text(item.film,"externalId");
            if(tv){Matcher matcher=Pattern.compile(":season:(\\d+)$").matcher(external);if(!matcher.find()||!seasonKnown||Integer.parseInt(matcher.group(1))!=season)continue;}
            else if(seasonKnown||info.optBoolean("episodeKnown"))continue;
            String localTitle=normalized(Json.text(parse(item.title()),"title")),original=normalized(Json.text(parse(Json.text(item.film,"originalTitle")),"title"));
            if(!title.equals(localTitle)&&!title.equals(original))continue;
            String fileYear=Json.text(info,"year");if(!tv&&!fileYear.isEmpty()&&item.film.optInt("year",0)>0&&!fileYear.equals(String.valueOf(item.film.optInt("year"))))continue;
            if(!found.isEmpty())return "";found=item.id();
        }return found;
    }
    static String description(JSONObject file){JSONObject info=file.optJSONObject("info");if(info==null)return "";StringBuilder text=new StringBuilder();for(String key:new String[]{"quality","source","codec","hdr","audio"}){String value=Json.text(info,key);if(!value.isEmpty()){if(text.length()>0)text.append(" · ");text.append(value);}}return text.toString();}
}
