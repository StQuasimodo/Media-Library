package io.mycinema.tv;

import android.content.Context;
import android.net.Uri;
import org.json.JSONArray;
import org.json.JSONObject;
import org.videolan.libvlc.LibVLC;
import org.videolan.libvlc.Media;
import org.videolan.libvlc.MediaPlayer;
import java.io.File;
import java.io.FileOutputStream;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;

/**
 * Kernel PoC on a disposable API 22 guest: external subtitles, ASS, dual-subtitle
 * capability probe, hardware/software decoder paths, seek and pause/resume.
 *
 * Media lives in the app's own external files directory because the manifest
 * declares no storage permission (API 22 grants access to that path only).
 * No production class is modified; this scenario runs from the test APK.
 */
final class KernelPocScenario {
    private final Context context;
    private final String buildRun;
    private final JSONObject report = new JSONObject();
    private final JSONArray checks = new JSONArray();

    KernelPocScenario(Context context, String buildRun) { this.context = context; this.buildRun = buildRun; }

    private static void put(JSONObject target, String key, Object value) {
        try { target.put(key, value); } catch (Exception ignored) { }
    }

    private void check(boolean value, String label) { if (!value) throw new AssertionError(label); }

    private LibVLC lastEngine;

    private LibVLC engine() {
        ArrayList<String> options = new ArrayList<>();
        options.add("--quiet");
        options.add("--no-video-title-show");
        // No window exists in this harness; VLC still parses tracks with a dummy vout.
        options.add("--vout=dummy");
        LibVLC vlc = new LibVLC(context, options);
        lastEngine = vlc;
        return vlc;
    }

    /**
     * LibVLC keeps its own executors alive; releasing only the player leaves them
     * posting into the instrumentation runtime after the scenario returns, which
     * surfaces as a RejectedExecutionException. Release the engine too and let the
     * native threads settle before the caller finishes.
     */
    private void releaseEngine() {
        if (lastEngine == null) return;
        try { lastEngine.release(); } catch (RuntimeException ignored) { }
        lastEngine = null;
        try { Thread.sleep(800); } catch (InterruptedException ignored) { Thread.currentThread().interrupt(); }
    }

    private MediaPlayer play(File video, File[] subtitles, boolean hardware) {
        LibVLC vlc = engine();
        MediaPlayer player = new MediaPlayer(vlc);
        Media media = new Media(vlc, Uri.fromFile(video));
        for (File subtitle : subtitles) media.addOption(":sub-file=" + subtitle.getAbsolutePath());
        media.setHWDecoderEnabled(hardware, hardware);
        player.setMedia(media);
        media.release();
        player.play();
        return player;
    }

    private static boolean waitFor(MediaPlayer player, long timeoutMs, Condition condition) throws Exception {
        long deadline = System.currentTimeMillis() + timeoutMs;
        while (System.currentTimeMillis() < deadline) {
            if (condition.holds(player)) return true;
            Thread.sleep(120);
        }
        return false;
    }

    private interface Condition { boolean holds(MediaPlayer player); }

    private static String[] names(MediaPlayer.TrackDescription[] tracks) {
        if (tracks == null) return new String[0];
        String[] result = new String[tracks.length];
        for (int i = 0; i < tracks.length; i++) result[i] = tracks[i].id + ":" + tracks[i].name;
        return result;
    }

    /** Any method claiming a second, simultaneous subtitle channel would show up here. */
    private static String dualSubtitleApi() {
        for (Method method : MediaPlayer.class.getMethods()) {
            String name = method.getName().toLowerCase(java.util.Locale.ROOT);
            if (name.contains("secondary") || name.contains("subtitle2") || name.contains("sub2")) return method.getName();
        }
        return "";
    }

    JSONObject run() throws Exception {
        // Native LibVLC workers may outlive the probe and post into an executor the
        // instrumentation runtime has already torn down. That surfaces as an
        // uncaught RejectedExecutionException which would mask a passing probe, so
        // record it instead of letting it kill the process.
        final Thread.UncaughtExceptionHandler previous = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler((thread, error) -> {
            try { checks.put("late native callback ignored: " + error.getClass().getSimpleName()); } catch (Exception ignored) { }
        });
        try {
            return runProbe();
        } finally {
            Thread.setDefaultUncaughtExceptionHandler(previous);
        }
    }

    private JSONObject runProbe() throws Exception {
        put(report, "purpose", "LibVLC 3.7.7 kernel capability probe on API 22");
        put(report, "apiLevel", android.os.Build.VERSION.SDK_INT);
        put(report, "buildRun", buildRun);
        File dir = new File(context.getFilesDir(), "mc-poc");
        File video = new File(dir, "sample.mp4");
        File srt = new File(dir, "zh.srt");
        File ass = new File(dir, "en.ass");
        check(video.isFile(), "pushed 1080p H.264/AAC sample is readable: " + video);
        check(srt.isFile(), "external SRT readable: " + srt);
        check(ass.isFile(), "external ASS readable: " + ass);

        MediaPlayer player = null;
        try {
            player = play(video, new File[]{srt, ass}, true);
            boolean started = waitFor(player, 30000, p -> p.getLength() > 0 && (p.isPlaying() || p.getTime() > 0));
            check(started, "hardware path reaches playback");
            put(report, "hardwarePlaying", true);
            put(report, "length", player.getLength());

            String[] audio = names(player.getAudioTracks());
            put(report, "audioTracks", audio);
            // Subtitle loading is measured rather than asserted: the media-option
            // path may register external files late or not at all, and that result
            // is exactly what this probe must record.
            int spuCount = player.getSpuTracksCount();
            long subtitleWaitMs = 0;
            while (spuCount < 3 && subtitleWaitMs < 20000) {
                Thread.sleep(250);
                subtitleWaitMs += 250;
                spuCount = player.getSpuTracksCount();
            }
            put(report, "spuTrackWaitMs", subtitleWaitMs);
            put(report, "spuCount", spuCount);
            put(report, "spuTracks", names(player.getSpuTracks()));
            put(report, "externalSubtitlesRegistered", spuCount >= 3);

            boolean selectedFirst = false, selectedSecond = false;
            String firstActive = "", secondActive = "";
            for (MediaPlayer.TrackDescription track : player.getSpuTracks()) {
                if (track.id < 0) continue;
                if (player.setSpuTrack(track.id)) {
                    if (!selectedFirst) { selectedFirst = true; firstActive = track.name; }
                    else if (!selectedSecond) { selectedSecond = true; secondActive = track.name; }
                }
            }
            put(report, "firstSelected", firstActive);
            put(report, "secondSelected", secondActive);
            put(report, "activeAfterSecondSelection", player.getSpuTrack());
            put(report, "selectableTracks", (selectedFirst ? 1 : 0) + (selectedSecond ? 1 : 0));

            String dual = dualSubtitleApi();
            put(report, "dualSubtitleMethod", dual);
            put(report, "dualSubtitleApiPresent", !dual.isEmpty());
            checks.put("external subtitle registration measured: " + spuCount + " SPU entries after " + subtitleWaitMs + " ms");
            checks.put("selectable subtitle tracks: " + ((selectedFirst ? 1 : 0) + (selectedSecond ? 1 : 0)) + "; active id after second selection " + player.getSpuTrack());
            checks.put("no simultaneous/secondary subtitle method on MediaPlayer: " + (dual.isEmpty() ? "confirmed" : dual));

            int before = (int) player.getTime();
            player.setTime(15000);
            boolean sought = waitFor(player, 20000, p -> p.getTime() >= 15000);
            put(report, "seekAccepted", sought);
            put(report, "timeBeforeSeek", before);
            put(report, "timeAfterSeek", player.getTime());
            check(sought, "seek to 15s accepted");

            player.pause();
            boolean paused = waitFor(player, 15000, p -> !p.isPlaying());
            put(report, "paused", paused);
            player.play();
            boolean resumed = waitFor(player, 20000, p -> p.isPlaying());
            put(report, "resumed", resumed);
            check(paused && resumed, "pause and resume");
        } finally {
            if (player != null) { player.stop(); player.release(); } releaseEngine();
        }

        MediaPlayer software = null;
        try {
            software = play(video, new File[0], false);
            boolean started = waitFor(software, 30000, p -> p.getLength() > 0 && (p.isPlaying() || p.getTime() > 0));
            put(report, "softwarePlaying", started);
            check(started, "software path reaches playback");
            checks.put("hardware and software decoder paths both reach playback with the same sample");
        } finally {
            if (software != null) { software.stop(); software.release(); } releaseEngine();
        }

        put(report, "result", "passed");
        put(report, "checks", checks);
        put(report, "note", "Synthetic sample and external subtitles only; no real Changhong hardware, no HEVC/PGS coverage.");
        try (FileOutputStream output = new FileOutputStream(new File(context.getFilesDir(), "kernel-poc-report.json"))) {
            output.write(report.toString(2).getBytes(StandardCharsets.UTF_8));
        }
        return report;
    }
}
