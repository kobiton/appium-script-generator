using OpenQA.Selenium;
using System.Drawing;
using System.Text;
using System.Xml;
using OpenQA.Selenium.Appium;

namespace AppiumTest
{
    public static class Utils
    {
        public static T Retry<T>(Func<int, T> execFn, Func<Exception, int, int>? handleExceptionFn = null,
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
                        throw e;
                    }
                }

                if (intervalInMs > 0)
                {
                    Thread.Sleep(intervalInMs);
                }
            }

            return default(T);
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

        public static string GetXPathOfNode(XmlNode node)
        {
            StringBuilder xpath = new StringBuilder();

            while (node != null)
            {
                switch (node.NodeType)
                {
                    case XmlNodeType.Attribute:
                        xpath.Insert(0, "/@" + node.Name);
                        node = ((XmlAttribute)node).OwnerElement;
                        break;
                    case XmlNodeType.Element:
                        int indexInParent = GetElementIndexInParent((XmlElement)node);
                        string nodeName = node.Name;

                        if (indexInParent > 0)
                        {
                            nodeName += $"[{indexInParent}]";
                        }

                        xpath.Insert(0, "/" + nodeName);
                        node = node.ParentNode;
                        break;
                    case XmlNodeType.Document:
                        return xpath.ToString();
                    default:
                        throw new ArgumentException("Unsupported XmlNode type: " + node.NodeType);
                }
            }

            return xpath.ToString();
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
