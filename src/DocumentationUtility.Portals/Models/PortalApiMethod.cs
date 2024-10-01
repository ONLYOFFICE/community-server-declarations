using ASC.Api.Attributes;
using DocumentationUtility.Shared.Models;
using DocumentationUtility.Shared.Statistics;
using System.Linq;
using System.Reflection;
using System.Xml.Linq;

namespace DocumentationUtility.Portals.Models
{
    public class PortalApiMethod : DocApiMethod
    {
        public bool RequiresAuthorization { get; protected set; } = true;

        public PortalApiMethod(DocApiController controller, MethodInfo type) : base(controller, type) { }

        protected override void ParseReflection()
        {
            var httpMethodAttributes = type.GetCustomAttributes<ApiAttribute>();
            var httpMethod = httpMethodAttributes.First();

            Path = httpMethod.Path.StartsWith("/") ? httpMethod.Path.Substring(1) : httpMethod.Path;
            Method = httpMethod.Method;
        }

        protected override bool HandleElement(XElement element)
        {
            if (base.HandleElement(element)) return true;

            switch (element.Name.LocalName)
            {
                case "path":
                case "httpMethod":
                case "collection":
                    return true; // ignore those, we are parsing them via reflection

                case "requiresAuthorization":
                    RequiresAuthorization = element.Value.ToLower().Trim() != "false";
                    return true;

                case "param":
                    Parameters.Add(new DocApiParameter(this, type.GetParameters().FirstOrDefault(p => p.Name == element.Attribute("name").Value), element.Value.Trim()));
                    return true;

                case "returns":
                    Returns = new DocApiReturn(this, element.Value.Trim(), type.ReturnType);
                    return true;

                case "category":
                    Category = element.Value.Trim();
                    return true;

                case "short":
                    ShortDescription = element.Value.Trim();
                    return true;
            }

            string item = type.Module.Name + ":" + Name;
            Statistics.CountUnhandled(element.Name.ToString(), item);
            return false;
        }
    }
}
