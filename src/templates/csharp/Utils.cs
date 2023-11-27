using NUnit.Framework;
using OpenQA.Selenium;
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace AppiumTest
{
    public static class Utils
    {
        public static T Retry<T>(Func<int, T> task, int maxAttempts, int intervalInMs)
        {
            for (int attempt = 1; attempt <= Math.Max(maxAttempts, 1); attempt++)
            {
                try
                {
                    return task.Invoke(attempt);
                }
                catch (Exception e)
                {
                    HandleException(e, attempt);
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

        public static void HandleException(Exception e, int attempt)
        {
            // Default implementation: do nothing
        }

        public static List<T> Retry<T>(Func<int, List<T>> task, int maxAttempts, int intervalInMs)
        {
            for (int attempt = 1; attempt <= Math.Max(maxAttempts, 1); attempt++)
            {
                try
                {
                    return task.Invoke(attempt);
                }
                catch (Exception e)
                {
                    HandleException(e, attempt);
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

            return default(List<T>);
        }
    }
}
