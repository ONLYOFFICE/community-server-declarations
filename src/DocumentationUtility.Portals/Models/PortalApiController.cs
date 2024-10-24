using ASC.Api.Attributes;
using DocumentationUtility.Shared.Models;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Xml.Linq;

namespace DocumentationUtility.Portals.Models
{
    public class PortalApiController : DocApiController
    {
        public PortalApiController(Type type) : base(type) { }

        protected override void ParseMethods()
        {
            foreach (var method in type.GetMethods().Where(m => m.GetCustomAttributes<ApiAttribute>().Any()))
            {
                var m = new PortalApiMethod(this, method);
                if (m.IsVisible) ApiMethods.Add(m);
            }
        }

        protected override void ParseReflection()
        {
            Path = Name;
            if (NameMap.TryGetValue(Name, out var mapped))
            {
                Name = mapped;
            }
        }

        protected override bool HandleElement(XElement element)
        {
            return base.HandleElement(element);
        }

        private static Dictionary<string, string> NameMap = new Dictionary<string, string>()
        {
            { "authentication", "Authentication" },
            { "calendar", "Calendar" },
            { "capabilities", "Capabilities" },
            { "community", "Community" },
            { "crm", "CRM" },
            { "feed", "Feed" },
            { "files", "Files" },
            { "group", "Group" },
            { "mail", "Mail" },
            { "mailserver", "Mail Server" },
            { "migration", "Migration" },
            { "people", "People" },
            { "portal", "Portal" },
            { "project", "Project" },
            { "security", "Security" },
            { "settings", "Settings" },
        };
    }
}
