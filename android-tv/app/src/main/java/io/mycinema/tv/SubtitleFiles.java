package io.mycinema.tv;

import android.content.Context;
import java.io.Closeable;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.json.JSONObject;
import okhttp3.HttpUrl;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;

/** Directory-scoped selection and a bounded private copy for LibVLC's subtitle reader. */
final class SubtitleFiles {
    static final long MAX_BYTES = 4L * 1024 * 1024;

    static List<MediaSources.Entry> list(MediaSources sources, JSONObject video) throws Exception {
        List<MediaSources.Entry> subtitles = new ArrayList<>();
        for (MediaSources.Entry entry : sources.list(Json.text(video, "source"), Json.text(video, "parent"))) {
            if (!entry.directory && !extension(entry.name).isEmpty()) subtitles.add(entry);
        }
        Collections.sort(subtitles, (left, right) -> {
            int name = left.name.compareToIgnoreCase(right.name);
            return name == 0 ? left.id.compareTo(right.id) : name;
        });
        return subtitles;
    }

    private static String extension(String name) {
        int dot = name.lastIndexOf('.');
        if (dot <= 0) return "";
        String ext = name.substring(dot + 1).toLowerCase(Locale.ROOT);
        return ext.equals("srt") || ext.equals("ass") || ext.equals("ssa") ? ext : "";
    }

    private static String stem(String name) {
        int dot = name.lastIndexOf('.');
        String base = dot > 0 ? name.substring(0, dot) : name;
        return Normalizer.normalize(base, Normalizer.Form.NFC).toLowerCase(Locale.ROOT);
    }

    private static int score(String video, String subtitle) {
        if (subtitle.equals(video)) return 0;
        if (!subtitle.startsWith(video + ".")) return Integer.MAX_VALUE;
        String language = subtitle.substring(video.length() + 1);
        if (language.matches("zh-cn|zh-hans|chs|sc|简体|简中")) return 1;
        if (language.matches("zh|zho|chi|中文|zh-tw|zh-hant|cht|tc|繁体|繁中")) return 2;
        if (language.matches("en|eng|en-us|en-gb|英文")) return 3;
        if (language.matches("ja|jpn|ko|kor|fr|fra|de|deu|es|spa|ru|rus|it|ita|pt|por")) return 4;
        return Integer.MAX_VALUE;
    }

    static MediaSources.Entry automatic(String videoName, List<MediaSources.Entry> entries) {
        String video = stem(videoName);
        if (video.isEmpty()) return null;
        MediaSources.Entry best = null;
        int bestScore = Integer.MAX_VALUE;
        boolean ambiguous = false;
        for (MediaSources.Entry entry : entries) {
            if (entry.size > MAX_BYTES) continue;
            int score = score(video, stem(entry.name));
            if (score < bestScore) {
                bestScore = score;
                best = entry;
                ambiguous = false;
            } else if (score == bestScore) {
                ambiguous = true;
            }
        }
        return ambiguous ? null : best;
    }

    private static File directory(Context context) {
        return new File(context.getCacheDir(), "playback-subtitles");
    }

    static void clearPreviousSessionFiles(Context context) {
        File[] copies = directory(context).listFiles();
        if (copies != null) for (File copy : copies) copy.delete();
    }

    static File fetch(Context context, MediaSources sources, MediaSources.Entry entry,
                      NetworkScope scope) throws Exception {
        String ext = extension(entry.name);
        if (entry.directory || ext.isEmpty()) throw new IOException("请选择 SRT、ASS 或 SSA 字幕。");
        if (entry.size > MAX_BYTES) throw new IOException("字幕文件超过 4 MiB。");

        MediaSources.Lease endpoint;
        Closeable relay;
        if (entry.source.equals("quark")) {
            PlaybackRelay.Session session = CinemaApplication.dav(context).openPlayback(entry.json(), scope);
            endpoint = session.endpoint;
            relay = session;
        } else {
            PlaybackRelay session = new PlaybackRelay(sources, entry.json());
            endpoint = new MediaSources.Lease(HttpUrl.parse(session.url()), Collections.emptyMap());
            relay = session;
        }
        try (Closeable owned = relay) {
            scope.own(owned);
            Request.Builder request = new Request.Builder().url(endpoint.url);
            for (Map.Entry<String, String> header : endpoint.headers.entrySet()) {
                request.header(header.getKey(), header.getValue());
            }
            try (NetworkScope.Exchange exchange = scope.open(MediaSources.HTTP, request.build())) {
                return copy(context, exchange.response, entry.size, ext, scope);
            }
        } finally {
            scope.disown(relay);
        }
    }

    private static File copy(Context context, Response response, long reportedSize, String extension,
                             NetworkScope scope) throws Exception {
        ResponseBody body = response.body();
        String type = response.header("Content-Type", "").toLowerCase(Locale.ROOT);
        if (response.code() != 200 || body == null || type.contains("html") || type.contains("json")) {
            throw new IOException("未能读取字幕文件。");
        }
        if (body.contentLength() > MAX_BYTES) throw new IOException("字幕文件超过 4 MiB。");
        File folder = directory(context);
        if (!folder.isDirectory() && !folder.mkdirs()) throw new IOException("无法创建字幕缓存。");
        File copy = File.createTempFile("subtitle-", "." + extension, folder);
        boolean ready = false;
        try {
            long received = 0;
            try (InputStream input = body.byteStream(); FileOutputStream output = new FileOutputStream(copy)) {
                byte[] buffer = new byte[8192];
                int count;
                while ((count = input.read(buffer)) != -1) {
                    scope.check();
                    received += count;
                    if (received > MAX_BYTES) throw new IOException("字幕文件超过 4 MiB。");
                    output.write(buffer, 0, count);
                }
            }
            if (received == 0 || (reportedSize > 0 && received != reportedSize)) {
                throw new IOException("字幕文件读取不完整。");
            }
            scope.check();
            ready = true;
            return copy;
        } finally {
            if (!ready) copy.delete();
        }
    }
}
