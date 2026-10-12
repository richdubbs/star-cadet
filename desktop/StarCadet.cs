// Star Cadet desktop launcher.
// Serves the game (embedded in this exe as resources) on 127.0.0.1 and opens it in a Microsoft Edge app window.
// Build with desktop/build.mjs (needs only the .NET Framework 4 compiler that ships with Windows).
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Windows.Forms;

[assembly: AssemblyTitle("Star Cadet")]
[assembly: AssemblyProduct("Star Cadet")]
[assembly: AssemblyDescription("3D pinball (unofficial fan remake)")]
[assembly: AssemblyVersion("0.2.0.0")]

static class StarCadet
{
    // A fixed port keeps the page origin stable, so options, high scores and cached sounds survive restarts.
    const int PreferredPort = 47123;
    const string Marker = "/__star-cadet";

    static readonly Dictionary<string, string> Types = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
    {
        { ".html", "text/html; charset=utf-8" }, { ".js", "text/javascript; charset=utf-8" }, { ".mjs", "text/javascript; charset=utf-8" },
        { ".css", "text/css; charset=utf-8" }, { ".json", "application/json" }, { ".txt", "text/plain; charset=utf-8" },
        { ".png", "image/png" }, { ".svg", "image/svg+xml" }, { ".ico", "image/x-icon" },
        { ".wav", "audio/wav" }, { ".mid", "audio/midi" }, { ".zip", "application/zip" },
    };

    static readonly Assembly Self = Assembly.GetExecutingAssembly();
    static readonly string ExeDir = Path.GetDirectoryName(Self.Location);

    [STAThread]
    static int Main()
    {
        int port = PreferredPort;
        TcpListener listener = TryListen(port);
        if (listener == null)
        {
            if (IsOurServer(port)) { OpenWindow(port); return 0; }   // already running: just open another window
            listener = TryListen(0);
            if (listener == null) { MessageBox.Show("Star Cadet could not start its local server.", "Star Cadet"); return 1; }
            port = ((IPEndPoint)listener.LocalEndpoint).Port;
        }
        var server = new Thread(() => Serve(listener)) { IsBackground = true };
        server.Start();

        if (OpenWindow(port)) WaitForEdgeWindow();
        else MessageBox.Show("Star Cadet is running in your web browser.\n\nClick OK to quit.", "Star Cadet");
        listener.Stop();
        return 0;
    }

    static TcpListener TryListen(int port)
    {
        try { var l = new TcpListener(IPAddress.Loopback, port); l.Start(); return l; }
        catch (SocketException) { return null; }
    }

    static bool IsOurServer(int port)
    {
        try
        {
            var req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + port + Marker);
            req.Timeout = 1500;
            using (var res = (HttpWebResponse)req.GetResponse()) return res.StatusCode == HttpStatusCode.OK;
        }
        catch { return false; }
    }

    static readonly string Profile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "StarCadet", "EdgeProfile");

    // Opens the game in an Edge app window with its own profile (true), or in the default browser (false).
    static bool OpenWindow(int port)
    {
        string url = "http://127.0.0.1:" + port + "/";
        string edgePath = FindEdge();
        if (edgePath != null)
        {
            Directory.CreateDirectory(Profile);
            var psi = new ProcessStartInfo(edgePath,
                "--app=" + url + " --user-data-dir=\"" + Profile + "\" --no-first-run --no-default-browser-check" +
                " --disable-background-mode --autoplay-policy=no-user-gesture-required --window-size=1280,900");
            psi.UseShellExecute = false;
            try { Process.Start(psi); return true; } catch { }
        }
        try { Process.Start(url); } catch { }
        return false;
    }

    // The process Edge's launcher returns can hand over to another one and exit at once, so wait until no Edge process
    // using our profile is left (checked every 2 s, after a grace period for start-up).
    static void WaitForEdgeWindow()
    {
        Thread.Sleep(5000);
        int misses = 0;
        DateTime start = DateTime.UtcNow;
        while (misses < 2)
        {
            Thread.Sleep(2000);
            bool running = EdgeUsesProfile();
            if (running) misses = 0;
            else if ((DateTime.UtcNow - start).TotalSeconds > 20) misses++;
        }
    }

    static bool EdgeUsesProfile()
    {
        string needle = Profile.ToLowerInvariant();
        try
        {
            using (var q = new System.Management.ManagementObjectSearcher("SELECT CommandLine FROM Win32_Process WHERE Name = 'msedge.exe'"))
            using (var results = q.Get())
            {
                foreach (var p in results)
                {
                    var cmd = p["CommandLine"] as string;
                    if (cmd != null && cmd.ToLowerInvariant().Contains(needle)) return true;
                }
            }
            return false;
        }
        catch { return true; }   // cannot tell: keep serving
    }

    static string FindEdge()
    {
        foreach (var root in new[] {
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData) })
        {
            if (string.IsNullOrEmpty(root)) continue;
            string p = Path.Combine(root, @"Microsoft\Edge\Application\msedge.exe");
            if (File.Exists(p)) return p;
        }
        return null;
    }

    static void Serve(TcpListener listener)
    {
        while (true)
        {
            TcpClient client;
            try { client = listener.AcceptTcpClient(); } catch { return; }
            ThreadPool.QueueUserWorkItem(_ => Handle(client));
        }
    }

    static void Handle(TcpClient client)
    {
        using (client)
        {
            try
            {
                client.ReceiveTimeout = 10000;
                NetworkStream stream = client.GetStream();
                string requestLine = ReadHead(stream);
                if (requestLine == null) return;
                string[] parts = requestLine.Split(' ');
                if (parts.Length < 2) return;
                string method = parts[0];
                string path = Uri.UnescapeDataString(parts[1].Split('?', '#')[0]);
                if (method != "GET" && method != "HEAD") { Send(stream, 405, "text/plain", Encoding.ASCII.GetBytes("405"), false); return; }
                if (path == Marker) { Send(stream, 200, "text/plain", Encoding.ASCII.GetBytes("ok"), method == "HEAD"); return; }
                if (path.EndsWith("/")) path += "index.html";
                byte[] body = Load(path.TrimStart('/'));
                if (body == null) { Send(stream, 404, "text/plain", Encoding.ASCII.GetBytes("404"), method == "HEAD"); return; }
                string type;
                if (!Types.TryGetValue(Path.GetExtension(path), out type)) type = "application/octet-stream";
                Send(stream, 200, type, body, method == "HEAD");
            }
            catch { }
        }
    }

    // Reads the request head and returns its first line.
    static string ReadHead(NetworkStream stream)
    {
        var head = new StringBuilder();
        int b;
        while ((b = stream.ReadByte()) != -1)
        {
            head.Append((char)b);
            if (head.Length > 16384) return null;
            int n = head.Length;
            if (n >= 4 && head[n - 4] == '\r' && head[n - 3] == '\n' && head[n - 2] == '\r' && head[n - 1] == '\n') break;
        }
        string s = head.ToString();
        int eol = s.IndexOf("\r\n", StringComparison.Ordinal);
        return eol > 0 ? s.Substring(0, eol) : null;
    }

    static byte[] Load(string rel)
    {
        if (rel.Contains("..") || rel.Contains("\\") || rel.Contains(":")) return null;
        // Players may drop their own copies of the original sound files into a "sounds" folder next to the exe.
        if (rel.StartsWith("sounds/", StringComparison.OrdinalIgnoreCase))
        {
            string file = Path.Combine(ExeDir, "sounds", rel.Substring(7));
            return File.Exists(file) ? File.ReadAllBytes(file) : null;
        }
        using (Stream s = Self.GetManifestResourceStream("web/" + rel))
        {
            if (s == null) return null;
            var ms = new MemoryStream();
            s.CopyTo(ms);
            return ms.ToArray();
        }
    }

    static void Send(NetworkStream stream, int status, string type, byte[] body, bool headOnly)
    {
        string reason = status == 200 ? "OK" : status == 404 ? "Not Found" : "Method Not Allowed";
        string head = "HTTP/1.1 " + status + " " + reason + "\r\n" +
            "Content-Type: " + type + "\r\n" +
            "Content-Length: " + body.Length + "\r\n" +
            "Cache-Control: no-cache\r\n" +
            "Connection: close\r\n\r\n";
        byte[] h = Encoding.ASCII.GetBytes(head);
        stream.Write(h, 0, h.Length);
        if (!headOnly) stream.Write(body, 0, body.Length);
        stream.Flush();
    }
}
