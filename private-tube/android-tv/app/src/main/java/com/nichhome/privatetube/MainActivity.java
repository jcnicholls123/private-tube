package com.nichhome.privatetube;

import android.app.Activity;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Typeface;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

public class MainActivity extends Activity {
    private static final String PREFS = "nichtube";
    private static final String KEY_SERVER_URL = "server_url";
    private static final String DEFAULT_SERVER_URL = "http://10.69.24.3:3020";

    private final Handler handler = new Handler(Looper.getMainLooper());
    private SharedPreferences prefs;
    private FrameLayout root;
    private LinearLayout launcher;
    private EditText serverInput;
    private TextView headline;
    private TextView intro;
    private TextView status;
    private TextView countdownText;
    private ProgressBar countdownRing;
    private WebView webView;
    private Runnable autoOpenRunnable;
    private int countdown = 3;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN, WindowManager.LayoutParams.FLAG_FULLSCREEN);

        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(8, 8, 8));
        setContentView(root);
        showLauncher();
    }

    private void showLauncher() {
        stopCountdown();
        root.removeAllViews();
        webView = null;

        launcher = new LinearLayout(this);
        launcher.setOrientation(LinearLayout.VERTICAL);
        launcher.setGravity(Gravity.CENTER);
        launcher.setPadding(dp(72), dp(54), dp(72), dp(54));

        FrameLayout panel = new FrameLayout(this);
        panel.setBackgroundColor(Color.rgb(24, 24, 24));
        FrameLayout.LayoutParams panelParams = new FrameLayout.LayoutParams(dp(860), ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER);
        root.addView(panel, panelParams);
        panel.addView(launcher, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        TextView brand = text("NichTube TV", 30, Color.WHITE, Typeface.BOLD);
        brand.setGravity(Gravity.CENTER);
        launcher.addView(brand, rowParams());

        countdownRing = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        countdownRing.setMax(3);
        countdownRing.setProgress(3);
        launcher.addView(countdownRing, fixedParams(dp(168), dp(16)));

        countdownText = text("3", 48, Color.WHITE, Typeface.BOLD);
        countdownText.setGravity(Gravity.CENTER);
        launcher.addView(countdownText, rowParams());

        headline = text("Opening TV mode", 54, Color.WHITE, Typeface.BOLD);
        headline.setGravity(Gravity.CENTER);
        launcher.addView(headline, rowParams());

        intro = text("Saved server loaded. Use Open now, or change the address before launch.", 23, Color.rgb(190, 190, 190), Typeface.NORMAL);
        intro.setGravity(Gravity.CENTER);
        launcher.addView(intro, rowParams());

        serverInput = new EditText(this);
        serverInput.setSingleLine(true);
        serverInput.setTextColor(Color.WHITE);
        serverInput.setTextSize(22);
        serverInput.setHintTextColor(Color.rgb(150, 150, 150));
        serverInput.setHint(DEFAULT_SERVER_URL);
        serverInput.setPadding(dp(18), 0, dp(18), 0);
        launcher.addView(serverInput, inputParams());

        LinearLayout actions = new LinearLayout(this);
        actions.setOrientation(LinearLayout.HORIZONTAL);
        actions.setGravity(Gravity.CENTER);
        launcher.addView(actions, rowParams());

        Button open = button("Open");
        Button change = button("Change");
        Button save = button("Save");
        Button clear = button("Clear");
        actions.addView(open, actionParams());
        actions.addView(change, actionParams());
        actions.addView(save, actionParams());
        actions.addView(clear, actionParams());

        status = text("", 18, Color.rgb(180, 180, 180), Typeface.NORMAL);
        status.setGravity(Gravity.CENTER);
        launcher.addView(status, rowParams());

        boolean hasSavedUrl = prefs.contains(KEY_SERVER_URL);
        String savedUrl = prefs.getString(KEY_SERVER_URL, "");
        serverInput.setText(hasSavedUrl ? savedUrl : DEFAULT_SERVER_URL);

        open.setOnClickListener(v -> openTv(false));
        change.setOnClickListener(v -> editUrl());
        save.setOnClickListener(v -> saveUrl());
        clear.setOnClickListener(v -> clearUrl());

        if (hasSavedUrl && savedUrl != null && savedUrl.trim().length() > 0) {
            startCountdown();
            open.requestFocus();
        } else {
            editUrl();
        }
    }

    private void startCountdown() {
        serverInput.setEnabled(false);
        headline.setText("Opening TV mode");
        intro.setText("Saved server loaded. Use Open now, or change the address before launch.");
        countdown = 3;
        tickCountdown();
    }

    private void tickCountdown() {
        countdownText.setText(String.valueOf(countdown));
        countdownRing.setProgress(countdown);
        status.setText("Auto-opening in " + countdown + " seconds.");
        if (countdown <= 0) {
            openTv(true);
            return;
        }
        autoOpenRunnable = () -> {
            countdown -= 1;
            tickCountdown();
        };
        handler.postDelayed(autoOpenRunnable, 1000);
    }

    private void stopCountdown() {
        if (autoOpenRunnable != null) handler.removeCallbacks(autoOpenRunnable);
        autoOpenRunnable = null;
    }

    private String normalizeUrl(String value) {
        String trimmed = value == null ? "" : value.trim();
        if (trimmed.endsWith("/")) trimmed = trimmed.substring(0, trimmed.length() - 1);
        if (trimmed.endsWith("/tv.html")) trimmed = trimmed.substring(0, trimmed.length() - 8);
        if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) return "";
        return trimmed;
    }

    private String tvUrl(String baseUrl) {
        return baseUrl + "/tv.html";
    }

    private String saveUrl() {
        String url = normalizeUrl(serverInput.getText().toString());
        if (url.length() == 0) {
            status.setText("Enter a valid internal PrivateTube URL.");
            return "";
        }
        prefs.edit().putString(KEY_SERVER_URL, url).apply();
        serverInput.setText(url);
        status.setText("Saved.");
        return url;
    }

    private void openTv(boolean skipSave) {
        stopCountdown();
        String url = skipSave ? normalizeUrl(serverInput.getText().toString()) : saveUrl();
        if (url.length() == 0) return;

        root.removeAllViews();
        webView = new WebView(this);
        webView.setBackgroundColor(Color.BLACK);
        webView.setFocusable(true);
        webView.setFocusableInTouchMode(true);
        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new WebChromeClient());

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);

        root.addView(webView, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        webView.loadUrl(tvUrl(url));
        webView.requestFocus();
    }

    private void editUrl() {
        stopCountdown();
        serverInput.setEnabled(true);
        headline.setText("Server settings");
        intro.setText("Edit the server URL, save it, then open TV mode.");
        status.setText("Edit the internal URL, then Save or Open.");
        countdownText.setText("0");
        countdownRing.setProgress(0);
        serverInput.requestFocus();
        serverInput.selectAll();
    }

    private void clearUrl() {
        stopCountdown();
        prefs.edit().remove(KEY_SERVER_URL).apply();
        serverInput.setEnabled(true);
        serverInput.setText("");
        headline.setText("Server settings");
        intro.setText("Enter your internal PrivateTube server address.");
        status.setText("Saved URL cleared.");
        countdownText.setText("0");
        countdownRing.setProgress(0);
        serverInput.requestFocus();
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (webView != null && (keyCode == KeyEvent.KEYCODE_BACK || keyCode == KeyEvent.KEYCODE_ESCAPE)) {
            if (webView.canGoBack()) {
                webView.goBack();
            } else {
                showLauncher();
            }
            return true;
        }
        if (keyCode == KeyEvent.KEYCODE_BACK || keyCode == KeyEvent.KEYCODE_ESCAPE) {
            editUrl();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    private TextView text(String value, int sp, int color, int style) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(sp);
        view.setTextColor(color);
        view.setTypeface(Typeface.DEFAULT, style);
        return view;
    }

    private Button button(String value) {
        Button button = new Button(this);
        button.setText(value);
        button.setTextSize(20);
        button.setTextColor(Color.WHITE);
        button.setAllCaps(false);
        return button;
    }

    private LinearLayout.LayoutParams rowParams() {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        params.setMargins(0, dp(8), 0, dp(8));
        return params;
    }

    private LinearLayout.LayoutParams inputParams() {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(68));
        params.setMargins(0, dp(20), 0, dp(14));
        return params;
    }

    private LinearLayout.LayoutParams actionParams() {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, dp(64), 1);
        params.setMargins(dp(7), 0, dp(7), 0);
        return params;
    }

    private LinearLayout.LayoutParams fixedParams(int width, int height) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(width, height);
        params.setMargins(0, dp(14), 0, dp(8));
        return params;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
