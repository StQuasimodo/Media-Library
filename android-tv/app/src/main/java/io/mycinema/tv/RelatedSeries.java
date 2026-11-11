package io.mycinema.tv;

import java.text.Normalizer;
import java.util.*;
import org.json.JSONArray;
import org.json.JSONObject;

/** Cross-media inference, not a claim that TMDB supplied an official TV/movie relation. */
final class RelatedSeries {
    interface Alive {boolean active();}
    static String seriesTitle(String text){return text.replaceAll("(?i)\\s*[·._ -]*第\\s*\\d+\\s*季\\s*$","").replaceAll("(?i)\\s*[·._ -]*(?:Season\\s*|S)\\d+\\s*$","").replaceAll("\\s*·\\s*特别篇$","").trim();}
    private static String words(String text){return Normalizer.normalize(text,Normalizer.Form.NFKD).toLowerCase(Locale.ROOT).replaceAll("\\p{M}","").replaceAll("(电影版|剧场版|大电影|电影)"," $1 ").replaceAll("[^\\p{L}\\p{N}]+"," ").trim();}
    private static Set<Integer> ids(JSONArray values){Set<Integer> result=new HashSet<>();for(int i=0;i<values.length();i++){Object raw=values.opt(i);if(!(raw instanceof Number))continue;double value=((Number)raw).doubleValue();if(value>0&&value<=Integer.MAX_VALUE&&value==Math.rint(value))result.add((int)value);}return result;}
    private static int common(JSONArray a,JSONArray b){Set<Integer> intersection=ids(a);intersection.retainAll(ids(b));return intersection.size();}
    static List<JSONObject> targets(List<Library.Item> items){
        LinkedHashMap<String,JSONObject> result=new LinkedHashMap<>();
        for(Library.Item item:items){JSONObject film=item.film;if(!Json.text(film,"mediaType").equals("tv")||!Json.text(film,"metadataSource").equals("tmdb"))continue;String external=Json.text(film,"externalId");if(!external.matches("[0-9]+(?::season:[0-9]+)?"))continue;String id=external.split(":")[0];JSONObject target=result.get(id);if(target==null){target=new JSONObject();Json.put(target,"id",id);Json.put(target,"title",seriesTitle(item.title()));Json.put(target,"aliases",new JSONArray());result.put(id,target);}JSONArray aliases=Json.array(target,"aliases");for(String alias:new String[]{seriesTitle(item.title()),seriesTitle(Json.text(film,"originalTitle"))}){boolean found=alias.isEmpty();for(int i=0;i<aliases.length();i++)if(alias.equals(aliases.optString(i)))found=true;if(!found)aliases.put(alias);}}
        for(Library.Item item:items){String external=Json.text(item.film,"externalId"),id=external.split(":")[0];JSONObject target=result.get(id),series=item.film.optJSONObject("series"),hints=series==null?null:series.optJSONObject("relationshipHints");if(target!=null&&Json.text(item.film,"mediaType").equals("tv")&&validHints(hints)&&(!target.has("hints")||Json.text(item.film,"metadataUpdatedAt").compareTo(Json.text(target,"hintsAt"))>0)){Json.put(target,"hints",hints);Json.put(target,"hintsAt",Json.text(item.film,"metadataUpdatedAt"));}}
        return new ArrayList<>(result.values());
    }
    static JSONObject titleEvidence(JSONObject movie,JSONObject target){
        Set<String> matches=new HashSet<>();boolean distinctive=false;Set<String> stop=new HashSet<>(Arrays.asList("the","a","an","movie","film","tv","series"));
        JSONArray aliases=Json.array(target,"aliases");for(int i=0;i<aliases.length();i++){String name=words(aliases.optString(i));if(name.length()<2)continue;
            if((" "+words(Json.text(movie,"title"))+" ").contains(" "+name+" ")||(" "+words(Json.text(movie,"originalTitle"))+" ").contains(" "+name+" ")){matches.add(name);int tokens=0;for(String token:name.split(" "))if(!stop.contains(token)){tokens++;if(token.length()>=8)distinctive=true;}if(tokens>=2||name.matches(".*[\\u3400-\\u9fff]{3}.*"))distinctive=true;}}
        JSONObject evidence=new JSONObject();Json.put(evidence,"matches",matches.size());Json.put(evidence,"distinctive",distinctive);return evidence;
    }
    static JSONObject match(JSONObject movie,JSONObject target,JSONObject movieHints,JSONObject tvHints){
        JSONObject names=titleEvidence(movie,target);int cast=common(Json.array(movieHints,"cast"),Json.array(tvHints,"cast")),creators=common(Json.array(movieHints,"creators"),Json.array(tvHints,"creators"));boolean continuation=continuation(movieHints);
        boolean named=names.optInt("matches")>0&&names.optBoolean("distinctive")&&(cast>=2||(cast>=1&&(creators>=1||continuation))),unnamed=continuation&&cast>=3&&creators>=1;
        if(!named&&!unnamed)return null;int score=Math.min(names.optInt("matches"),2)*20+Math.min(cast,3)*20+(creators>0?25:0)+(continuation?25:0);if(score<70)return null;
        JSONObject result=new JSONObject();Json.put(result,"tvId",Json.text(target,"id"));Json.put(result,"title",Json.text(target,"title"));Json.put(result,"source","tmdb-evidence-v1");Json.put(result,"score",score);JSONArray evidence=new JSONArray();if(names.optInt("matches")>0)evidence.put("title");if(cast>0)evidence.put("cast:"+cast);if(creators>0)evidence.put("creator:"+creators);if(continuation)evidence.put("continuation-keyword");Json.put(result,"evidence",evidence);return result;
    }
    static boolean validHints(JSONObject hints){return hints!=null&&hints.optJSONArray("cast")!=null&&hints.optJSONArray("creators")!=null&&hints.optJSONArray("keywords")!=null;}
    static boolean continuation(JSONObject hints){List<String> keywords=Arrays.asList("spin off","based on tv series","based on television series","continuation of tv series","sequel to tv series","改编自电视剧","电视剧衍生");JSONArray raw=Json.array(hints,"keywords");for(int i=0;i<raw.length();i++)if(keywords.contains(words(raw.optString(i))))return true;return false;}
    static JSONObject choose(List<JSONObject> candidates){Collections.sort(candidates,(a,b)->{int score=Integer.compare(b.optInt("score"),a.optInt("score"));return score!=0?score:Json.text(a,"tvId").compareTo(Json.text(b,"tvId"));});return candidates.isEmpty()||candidates.size()>1&&candidates.get(0).optInt("score")-candidates.get(1).optInt("score")<15?null:candidates.get(0);}
    static boolean writable(JSONObject film){JSONObject series=film.optJSONObject("series");return Json.text(film,"mediaType").equals("movie")&&Json.text(film,"metadataSource").equals("tmdb")&&!Json.text(film,"externalId").isEmpty()&&(series==null||!series.has("franchise")&&!Json.text(series,"key").startsWith("manual:"));}
    private static String version(List<Library.Item> items){List<String> versions=new ArrayList<>();for(Library.Item item:items)if(Json.text(item.film,"mediaType").equals("tv"))versions.add(item.id()+":"+Json.text(item.film,"externalId")+":"+item.title()+":"+Json.text(item.film,"originalTitle")+":"+Json.text(item.film,"metadataUpdatedAt"));Collections.sort(versions);return versions.toString();}
    static int resolve(Library library,TmdbClient client,FranchiseFolders folders,Alive alive)throws Exception{
        List<Library.Item> items=library.list("","","","","recent");List<JSONObject> targets=targets(items);String snapshot=version(items);int updated=0;
        for(Library.Item item:items){if(!alive.active())return updated;if(!writable(item.film))continue;JSONObject copy=Json.copy(item.film),series=copy.optJSONObject("series");if(series!=null)series.remove("relatedTv");if(folders.universe(new Library.Item(copy,Json.copy(item.entry)))!=null)continue;
            JSONObject itemSeries=item.film.optJSONObject("series"),stored=itemSeries==null?null:itemSeries.optJSONObject("relationshipHints");List<JSONObject> possible=new ArrayList<>();for(JSONObject target:targets)if(titleEvidence(item.film,target).optInt("matches")>0)possible.add(target);if(possible.isEmpty()&&validHints(stored)&&continuation(stored))possible.addAll(targets);List<JSONObject> matches=new ArrayList<>();
            if(!possible.isEmpty()){JSONObject hints=validHints(stored)?stored:client.relationshipHints(Json.text(item.film,"externalId"),"movie");if(Json.array(hints,"cast").length()>0)for(JSONObject target:possible){if(!alive.active())return updated;JSONObject targetHints=target.optJSONObject("hints");JSONObject match=match(item.film,target,hints,validHints(targetHints)?targetHints:client.relationshipHints(Json.text(target,"id"),"tv"));if(match!=null)matches.add(match);}}
            if(!alive.active())return updated;List<Library.Item> fresh=library.list("","","","","recent");if(!version(fresh).equals(snapshot))return updated;JSONObject related=choose(matches);if(related!=null){boolean exists=false;for(JSONObject target:targets(fresh))if(Json.text(target,"id").equals(Json.text(related,"tvId")))exists=true;if(!exists)continue;}
            if(library.setRelatedTv(item.id(),item.film,related))updated++;
        }return updated;
    }
}
