package io.mycinema.tv;

import org.json.JSONObject;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Conservative filename facts; ambiguous titles are left for user association. */
final class ResourceName {
    private static String find(String name,String pattern){Matcher matcher=Pattern.compile(pattern,Pattern.CASE_INSENSITIVE).matcher(name);return matcher.find()?matcher.group():"";}
    static JSONObject parse(String name){
        JSONObject info=new JSONObject();String clean=name.replaceAll("\\.[A-Za-z0-9]{2,5}$","");
        Matcher season=Pattern.compile("(?i)(?:\\bS(\\d{1,2})(?:E\\d{1,3})?|Season[ ._-]*(\\d{1,2})|第([0-9一二三四五六七八九十两]+)季)").matcher(clean);
        int seasonNumber=0;if(season.find()){String number=season.group(1)!=null?season.group(1):season.group(2)!=null?season.group(2):season.group(3);seasonNumber=number(number);}
        Matcher episode=Pattern.compile("(?i)(?:S\\d{1,2}E(\\d{1,3})|\\bE(?:P)?[ ._-]*(\\d{1,3})|第([0-9一二三四五六七八九十两]+)集)").matcher(clean);
        int episodeNumber=0;if(episode.find())episodeNumber=number(episode.group(1)!=null?episode.group(1):episode.group(2)!=null?episode.group(2):episode.group(3));
        String quality=find(clean,"(?<![a-z0-9])(?:4320p|2160p|1080[pi]|720p|480p|8k|4k|uhd)(?![a-z0-9])");
        String codec=find(clean,"(?:HEVC|AVC|x26[45]|h[ .]?26[45]|AV1|MPEG[ .-]?2)");
        String audio=find(clean,"(?:TrueHD(?:[ .]?[257]\\.1)?|DTS(?:[ .-]?(?:HD[ .-]?MA|X))?|DDP?(?:[ .]?[257]\\.1)?|E[ .-]?AC[ .-]?3|AC[ .-]?3|AAC|FLAC|Atmos)");
        String source=find(clean,"(?:Blu[ .-]?Ray|BDRemux|Remux|WEB[ .-]?(?:DL|Rip)|HDTV|BDRip|DVDRip)");
        String hdr=find(clean,"(?:HDR10\\+?|HDR|Dolby[ .]?Vision|\\bDV\\b)");
        String year=find(clean,"(?<!\\d)(?:19|20)\\d{2}(?!\\d)");
        int cut=clean.length();for(String marker:new String[]{quality,codec,audio,source,hdr,year})if(!marker.isEmpty()){int at=clean.toLowerCase(Locale.ROOT).indexOf(marker.toLowerCase(Locale.ROOT));if(at>=0)cut=Math.min(cut,at);}
        if(seasonNumber>0)cut=Math.min(cut,season.start());if(episodeNumber>0)cut=Math.min(cut,episode.start());
        String title=clean.substring(0,cut).replaceAll("^[\\[【][^\\]】]*[\\]】]","").replaceAll("[._]"," ").replaceAll("[\\[\\]【】()（） -]+$","").trim();
        Json.put(info,"title",title);Json.put(info,"season",seasonNumber);Json.put(info,"episode",episodeNumber);Json.put(info,"quality",quality.toUpperCase(Locale.ROOT));Json.put(info,"codec",codec);Json.put(info,"audio",audio);Json.put(info,"source",source);Json.put(info,"hdr",hdr);Json.put(info,"year",year);return info;
    }
    private static int number(String text){try{return Integer.parseInt(text);}catch(NumberFormatException ignored){String digits="零一二三四五六七八九";if(text.equals("两"))return 2;if(text.length()==1)return text.equals("十")?10:Math.max(0,digits.indexOf(text));int ten=text.indexOf('十');if(ten>=0){int tens=ten==0?1:digits.indexOf(text.charAt(0));int ones=ten+1==text.length()?0:digits.indexOf(text.charAt(ten+1));return Math.max(0,tens*10+ones);}return 0;}}
    static String normalized(String value){return value.toLowerCase(Locale.ROOT).replaceAll("[^\\p{L}\\p{N}]","");}
    static String match(String name,String parentName,List<Library.Item> items){
        JSONObject info=parse(name),folder=parse(parentName);String title=normalized(Json.text(info,"title"));if(title.isEmpty())title=normalized(Json.text(folder,"title"));
        int season=info.optInt("season");if(season==0)season=folder.optInt("season");String found="";
        if(title.length()<2)return "";
        for(Library.Item item:items){
            boolean tv=Json.text(item.film,"mediaType").equals("tv");String external=Json.text(item.film,"externalId");
            if(tv){Matcher matcher=Pattern.compile(":season:(\\d+)$").matcher(external);if(!matcher.find()||season==0||Integer.parseInt(matcher.group(1))!=season)continue;}
            else if(season>0||info.optInt("episode")>0)continue;
            String localTitle=normalized(Json.text(parse(item.title()),"title")),original=normalized(Json.text(parse(Json.text(item.film,"originalTitle")),"title"));
            if(!title.equals(localTitle)&&!title.equals(original))continue;
            String fileYear=Json.text(info,"year");if(!tv&&!fileYear.isEmpty()&&item.film.optInt("year",0)>0&&!fileYear.equals(String.valueOf(item.film.optInt("year"))))continue;
            if(!found.isEmpty())return "";found=item.id();
        }return found;
    }
    static String description(JSONObject file){JSONObject info=file.optJSONObject("info");if(info==null)return "";StringBuilder text=new StringBuilder();for(String key:new String[]{"quality","source","codec","hdr","audio"}){String value=Json.text(info,key);if(!value.isEmpty()){if(text.length()>0)text.append(" · ");text.append(value);}}return text.toString();}
}
