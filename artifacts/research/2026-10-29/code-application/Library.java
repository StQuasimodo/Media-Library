package io.mycinema.tv;
import org.json.JSONObject;
final class Library {static final class Item {final JSONObject film;private final String key;Item(String key,String title,String external,String type,int year){this.key=key;film=new JSONObject();Json.put(film,"title",title);Json.put(film,"externalId",external);Json.put(film,"mediaType",type);Json.put(film,"year",year);}String id(){return key;}String title(){return Json.text(film,"title");}}}
