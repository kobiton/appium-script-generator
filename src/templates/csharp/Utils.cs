using OpenQA.Selenium;
using System.Drawing;
using System.Text;
using System.Xml;
using HtmlAgilityPack;
using OpenQA.Selenium.Appium;

namespace AppiumTest
{
    public static class Utils
    {
        public static T? Retry<T>(Func<int, T> execFn, Func<Exception, int, int>? handleExceptionFn = null,
            int maxAttempts = 1, int intervalInMs = 0)
        {
            for (int attempt = 1; attempt <= Math.Max(maxAttempts, 1); attempt++)
            {
                try
                {
                    return execFn.Invoke(attempt);
                }
                catch (Exception e)
                {
                    handleExceptionFn?.Invoke(e, attempt);

                    if (attempt == maxAttempts)
                    {
                        throw;
                    }
                }

                if (intervalInMs > 0)
                {
                    Thread.Sleep(intervalInMs);
                }
            }

            return default;
        }

        public static string GetAllText(HtmlNode? node)
        {
            if (node == null)
                return string.Empty;

            var textBuilder = new StringBuilder();

            if (node.NodeType == HtmlNodeType.Text)
            {
                string text = node.InnerText.Trim();
                if (!string.IsNullOrEmpty(text))
                    textBuilder.Append(text + " ");
            }

            foreach (var child in node.ChildNodes)
            {
                textBuilder.Append(GetAllText(child));
            }

            return textBuilder.ToString().Trim();
        }

        public static string ConvertToOrdinal(int i)
        {
            string[] suffixes = new string[] { "th", "st", "nd", "rd", "th", "th", "th", "th", "th", "th" };
            switch (i % 100)
            {
                case 11:
                case 12:
                case 13:
                    return i + "th";
                default:
                    return i + suffixes[i % 10];
            }
        }

        public static bool IsStatusCodeSuccess(int statusCode)
        {
            return 200 <= statusCode && statusCode <= 299;
        }

        public static string GetLocatorText(params By[] locators)
        {
            List<string> locatorStrings = new List<string>();
            foreach (By locator in locators)
            {
                locatorStrings.Add(locator.ToString());
            }

            return string.Join(", ", locatorStrings);
        }

        public static bool IsRectangleInclude(Rectangle rect1, Rectangle rect2)
        {
            return rect1.X <= rect2.X &&
                   rect1.Y <= rect2.Y &&
                   rect1.X + rect1.Width >= rect2.X + rect2.Width &&
                   rect1.Y + rect1.Height >= rect2.Y + rect2.Height;
        }

        public static Point GetCenterOfElement(AppiumWebElement element)
        {
            var location = element.Location;
            var size = element.Size;
            return new Point(location.X + size.Width / 2,location.Y + size.Height / 2);
        }

        public static string GetXPath(XmlNode element)
        {
            var xpath = new StringBuilder();

            while (element != null)
            {
                string tagName = element.Name;
                int index = 1;

                var sibling = element.PreviousSibling;
                while (sibling != null)
                {
                    if (sibling.Name == tagName)
                    {
                        index++;
                    }
                    sibling = sibling.PreviousSibling;
                }

                bool hasMultipleSiblings = false;
                sibling = element.NextSibling;
                while (sibling != null)
                {
                    if (sibling.Name == tagName)
                    {
                        hasMultipleSiblings = true;
                        break;
                    }
                    sibling = sibling.NextSibling;
                }

                if (index > 1 || hasMultipleSiblings)
                {
                    xpath.Insert(0, $"/{tagName}[{index}]");
                }
                else
                {
                    xpath.Insert(0, $"/{tagName}");
                }

                element = element.ParentNode;
            }

            var finalXpath = xpath.ToString();
            if (finalXpath.StartsWith("/#document"))
            {
                finalXpath = finalXpath.Substring("/#document".Length);
            }

            return finalXpath;
        }

        private static int GetElementIndexInParent(XmlElement element)
        {
            XmlNode parentNode = element.ParentNode;
            if (parentNode == null)
            {
                return 0;
            }

            int index = 1;
            foreach (XmlNode sibling in parentNode.ChildNodes)
            {
                if (sibling == element)
                {
                    return parentNode.ChildNodes.Count == 1 ? 0 : index;
                }

                if (sibling is XmlElement)
                {
                    index++;
                }
            }

            return 0;
        }
    }
}
