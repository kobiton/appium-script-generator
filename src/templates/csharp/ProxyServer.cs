using System.Net;
using System.Net.Sockets;
using Newtonsoft.Json.Linq;

namespace AppiumTest
{
    public class ProxyServer
    {
        public long currentCommandId = 0;
        public long kobitonSessionId = 0;
        private bool forceW3C = false;
        private HttpListener listener;
        private int listeningPort = 0;

        public int CurrentCommandId
        {
            set { currentCommandId = value; }
        }

        public async Task StartProxy() {
            listeningPort = FindAvailablePort();
            listener = new HttpListener();
            listener.Prefixes.Add(GetServerUrl());

            try {
                listener.Start();
                Console.WriteLine($"Proxy server started at {GetServerUrl()}");

                while(true){
                    var context = await listener.GetContextAsync();
                    await Task.Run(() => HandleRequest(context, Config.AppiumServerUrl));
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine("Error: " + ex.Message);
            }
        }

        private void HandleRequest(HttpListenerContext context, string appiumServerUrl)
        {
            var request = context.Request;
            string urlString = request.Url.PathAndQuery;
            if (urlString.StartsWith("/wd/hub"))
            {
                urlString = urlString.Replace("/wd/hub", "");
            }

            if(Config.DeviceSource == Config.DeviceSourceEnums.Kobiton && currentCommandId > 0)
            {
                if (!string.IsNullOrEmpty(request.Url.Query))
                {
                    urlString += "&baseCommandId=" + currentCommandId;
                }
                else
                {
                    urlString += "?baseCommandId=" + currentCommandId;
                }
            }

            var url = new Uri(appiumServerUrl + urlString);

            using (var client = new HttpClient())
            {
                var httpRequest = new HttpRequestMessage
                {
                    RequestUri = url,
                    Method = new HttpMethod(request.HttpMethod),
                    Content = new StreamContent(request.InputStream)
                };

                httpRequest.Content.Headers.Add("Content-Type", "application/json");
                httpRequest.Headers.Add("Accept", "application/json");
                httpRequest.Headers.Add("Authorization", Config.GetBasicAuthString());

                var response = client.SendAsync(httpRequest).Result;
                var statusCode = (int)response.StatusCode;
                var responseData = response.Content.ReadAsByteArrayAsync().Result;
                var responseString = System.Text.Encoding.UTF8.GetString(responseData);
                
                var jsonResponse = JObject.Parse(responseString);
                if ("/session".Equals(request.Url.LocalPath, StringComparison.OrdinalIgnoreCase) && request.HttpMethod == "POST" && Utils.IsStatusCodeSuccess(statusCode))
                {
                    // Extract the kobitonSessionId
                    kobitonSessionId = jsonResponse["value"]["kobitonSessionId"].Value<long>();
                    
                    // Convert response body to W3C format if needed
                    if (jsonResponse["status"] != null && jsonResponse["sessionId"] != null)
                    {

                        // Update response to W3C format
                        forceW3C = true;
                        JObject desiredCapsJson = (JObject)jsonResponse["value"];

                        JObject w3cValueJson = new JObject();
                        w3cValueJson["capabilities"] = desiredCapsJson;
                        w3cValueJson["sessionId"] = jsonResponse["sessionId"];

                        JObject w3cBodyJson = new JObject();
                        w3cBodyJson["value"] = w3cValueJson;

                        responseString = w3cBodyJson.ToString();
                    }
                }

                // Convert JSON Wire error response to W3C format
                if (!Utils.IsStatusCodeSuccess(statusCode) && forceW3C)
                {
                    int appiumErrorCode = jsonResponse["status"].Value<int>();
                    
                    string error;

                    switch (appiumErrorCode)
                    {
                        case ErrorCodes.NotFound:
                            error = "Not Found";
                            break;
                        case ErrorCodes.InternalServerError:
                            error = "Internal Server Error";
                            break;
                        default:
                            error = "Unknown";
                            break;
                    }

                    jsonResponse["value"]["error"] = error;
                    responseString = jsonResponse.ToString();
                }
                
                context.Response.StatusCode = statusCode;
                
                string contentType = response.Content.Headers.ContentType?.MediaType;
                context.Response.ContentType = contentType;
                
                byte[] modifiedResponseData = System.Text.Encoding.UTF8.GetBytes(responseString);
                context.Response.ContentLength64 = modifiedResponseData.Length;
                context.Response.OutputStream.Write(modifiedResponseData, 0, modifiedResponseData.Length);

            }

            context.Response.Close();
        }

        public void StopProxy()
        {
            if (listener != null && listener.IsListening)
            {
                listener.Close();
                Console.WriteLine("Proxy server stopped");
            }
        }

        public string GetServerUrl()
        {
            return $"http://localhost:{listeningPort}/";
        }

        public int ListeningPort
        {
            get { return listeningPort; }
        }

        private int FindAvailablePort()
        {
            TcpListener listener = new TcpListener(IPAddress.Loopback, 0);
            listener.Start();
            int port = ((IPEndPoint)listener.LocalEndpoint).Port;
            listener.Stop();
            return port;
        }
    }

    public static class ErrorCodes
    {
        public const int NotFound = 404;
        public const int InternalServerError = 500;
    }
}
