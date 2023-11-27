using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Threading.Tasks;
using Newtonsoft.Json;

namespace AppiumTest
{
    public class ProxyServer : IDisposable
    {
        public long currentCommandId;
        public long kobitonSessionId;
        public JsonSerializerSettings jsonSerializerSettings = new JsonSerializerSettings
        {
            NullValueHandling = NullValueHandling.Ignore,
            MissingMemberHandling = MissingMemberHandling.Ignore,
            DateTimeZoneHandling = DateTimeZoneHandling.Utc
        };

        private readonly string authString = Config.GetBasicAuthString();
        private readonly int socketTimeoutInSecond = 15 * 60;
        private bool forceW3C = false;

        private readonly HttpClient httpClient;
        private int port;

        public ProxyServer()
        {
            var httpClientHandler = new HttpClientHandler
            {
                Proxy = null,
                UseProxy = false
            };
            
            httpClient = new HttpClient(httpClientHandler);
            httpClient.Timeout = TimeSpan.FromSeconds(socketTimeoutInSecond);
            
            httpClient.DefaultRequestHeaders.Add(HttpRequestHeader.Authorization.ToString(), authString);
        }

        public void Dispose()
        {
            httpClient?.Dispose();
        }

        public void Start()
        {
            port = GetAvailableTcpPort();
            HttpListener listener = new HttpListener();
            listener.Prefixes.Add($"http://localhost:{port}/");
            listener.Start();

            Console.WriteLine($"Proxy server started on port {port}...");

            while (true)
            {
                try
                {
                    var context = listener.GetContext();
                    Task.Run(async () => await ProcessRequest(context));
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"Error processing request: {ex.Message}");
                }
            }
        }

        public async Task ProcessRequest(HttpListenerContext context)
        {
            try
            {
                var request = context.Request;

                var httpRequest = BuildAppiumRequest(request);

                var httpResponse = await httpClient.SendAsync(httpRequest);

                await ProcessResponse(httpResponse, context, request.RawUrl, request.HttpMethod);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error processing request: {ex.Message}");
                context.Response.StatusCode = (int)HttpStatusCode.InternalServerError;
                context.Response.Close();
            }
        }

        public async Task ProcessResponse(HttpResponseMessage httpResponse, HttpListenerContext context, string requestUrl, string requestMethod)
        {
            context.Response.StatusCode = (int)httpResponse.StatusCode;
            context.Response.ContentType = httpResponse.Content.Headers.ContentType.ToString();

            var responseBody = await httpResponse.Content.ReadAsStringAsync();

            if (httpResponse.Content.Headers.ContentLength > 0)
            {
                using (var writer = new StreamWriter(context.Response.OutputStream))
                {
                    await writer.WriteAsync(responseBody);
                }
            }

            context.Response.Close();

            if (!string.IsNullOrEmpty(responseBody))
            {
                if (httpResponse.StatusCode == HttpStatusCode.OK && requestUrl == "/session" && requestMethod == "POST")
                {
                    var bodyJson = JsonConvert.DeserializeObject<Dictionary<string, object>>(responseBody, jsonSerializerSettings);
                    kobitonSessionId = (long)((Dictionary<string, object>)bodyJson["value"])["kobitonSessionId"];

                    // JSON Wire format, convert response body to W3C format
                    if (bodyJson.ContainsKey("status") && bodyJson.ContainsKey("sessionId"))
                    {
                        forceW3C = true;
                        var desiredCapsJson = (Dictionary<string, object>)bodyJson["value"];

                        var w3cValueJson = new Dictionary<string, object>
                        {
                            { "capabilities", desiredCapsJson },
                            { "sessionId", bodyJson["sessionId"].ToString() }
                        };

                        var w3cBodyJson = new Dictionary<string, object>
                        {
                            { "value", w3cValueJson }
                        };

                        responseBody = JsonConvert.SerializeObject(w3cBodyJson, jsonSerializerSettings);
                    }
                }

                // Convert JSON Wire error response to W3C format
                if (httpResponse.StatusCode != HttpStatusCode.OK && forceW3C)
                {
                    var bodyJson = JsonConvert.DeserializeObject<Dictionary<string, object>>(responseBody, jsonSerializerSettings);
                    int appiumErrorCode = int.Parse(bodyJson["status"].ToString());
                    var error = ErrorCodes.ToState(appiumErrorCode);
                    var valueJson = (Dictionary<string, object>)bodyJson["value"];
                    valueJson["error"] = error;
                    responseBody = JsonConvert.SerializeObject(bodyJson, jsonSerializerSettings);
                }

                using (var writer = new StreamWriter(context.Response.OutputStream))
                {
                    await writer.WriteAsync(responseBody);
                }
            }
        }

        public HttpRequestMessage BuildAppiumRequest(HttpListenerRequest request)
        {
            var method = request.HttpMethod;
            var uriString = Config.AppiumServerUrl + request.RawUrl;

            if (uriString.StartsWith("/wd/hub"))
            {
                uriString = uriString.Replace("/wd/hub", "");
            }

            var uri = new Uri(uriString);
            var httpRequest = new HttpRequestMessage(new HttpMethod(method), uri);

            if (method == "POST")
            {
                using (var reader = new StreamReader(request.InputStream))
                {
                    var bodyString = reader.ReadToEnd();
                    httpRequest.Content = new StringContent(bodyString, System.Text.Encoding.UTF8, "application/json");
                }
            }

            return httpRequest;
        }

        public int GetAvailableTcpPort()
        {
            var listener = new TcpListener(IPAddress.Loopback, 0);
            listener.Start();
            int port = ((IPEndPoint)listener.LocalEndpoint).Port;
            listener.Stop();
            return port;
        }

        public string GetServerUrl()
        {
            return $"http://localhost:{port}";
        }
    }

    public class ErrorCodes
    {
        public static string ToState(int errorCode)
        {
            // Define your error code to state mapping logic here
            throw new NotImplementedException();
        }
    }
}
