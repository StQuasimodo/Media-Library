package io.mycinema.tv;
import java.util.*;
import java.util.regex.*;
/** Display only; grouping keys and stored titles remain unchanged. */
final class FolderTitle {
    static String label(String value){String title=value.trim();List<String> notes=new ArrayList<>();Pattern suffix=Pattern.compile("\\s*[（(]([^()（）]*)[)）]\\s*$");
        for(;;){Matcher match=suffix.matcher(title);if(!match.find()||title.substring(0,match.start()).trim().isEmpty())break;title=title.substring(0,match.start()).trim();String note=match.group(1).trim(),kind=note.toLowerCase(Locale.ROOT).replaceAll("[\\s·._-]+","");if(!kind.matches("系列|合集|电影系列|系列电影|电视剧系列|影视宇宙|collection|filmcollection|moviecollection|series|filmseries|movieseries|saga")&&!note.matches("(共)?[0-9]+\\s*部(作品|电影|剧集)?")&&!note.toLowerCase(Locale.ROOT).matches("[0-9]+\\s*(movies|films|seasons)"))if(!note.isEmpty())notes.add(0,note);}
        StringBuilder result=new StringBuilder(title);for(String note:notes)result.append(' ').append(note);return result.toString();}
}
