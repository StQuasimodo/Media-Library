package io.mycinema.tv;
import org.json.*;import java.nio.file.*;import java.nio.charset.StandardCharsets;import java.util.*;
public final class ResourceNameProbe {public static void main(String[]args)throws Exception{
 JSONArray cases=new JSONArray(new String(Files.readAllBytes(Paths.get(args[0])),StandardCharsets.UTF_8)),results=new JSONArray();
 List<Library.Item> items=Arrays.asList(new Library.Item("bb0","Breaking Bad 第0季","1396:season:0","tv",2008),new Library.Item("bb1","Breaking Bad 第1季","1396:season:1","tv",2008),new Library.Item("bb2","Breaking Bad 第2季","1396:season:2","tv",2009),new Library.Item("1917","1917","530915","movie",2019));
 for(int n=0;n<cases.length();n++){JSONObject c=cases.getJSONObject(n);String file=c.getString("filename");JSONArray parents=c.getJSONArray("parents");JSONObject r=new JSONObject();r.put("id",c.getString("id"));r.put("parsed",ResourceName.parse(file));r.put("match",ResourceName.match(file,parents.length()==0?"":parents.getString(parents.length()-1),items));results.put(r);}
 System.out.println(results.toString(2));}}
